"""Explicit, public-corpus-only live evaluation. No production app/provider binding."""

import argparse
import asyncio
import ctypes
import hashlib
import ipaddress
import json
import logging
import os
import socket
import sqlite3
import sys
import time
from contextlib import closing
from pathlib import Path
from typing import Any, cast

import httpx
from fastapi import HTTPException

from app.assistant.planning_provider import (
    APPROVED_MODELS,
    MODEL,
    GeminiPlanningProvider,
    PlanningInput,
    PlanningModel,
    ProviderDataScopeError,
    ProviderQuotaExceeded,
    ProviderUnavailable,
)

ROOT = Path(__file__).resolve().parents[3]
STATE = ROOT / "backend/.pytest_cache/assistant-local-android/live-planner"
KEY_FILE = STATE / "gemini-key.dpapi"
GOOGLE_HOST = "generativelanguage.googleapis.com"
CORPUS_HASH = "2e090a21d5ed7b1e983ba014e6d03412ca803054c1778d006b9cffa49b9c5348"


def public_cases() -> dict[str, str]:
    corpus = json.loads(
        (ROOT / "tests/fixtures/assistant-planner-evaluation.json").read_text(
            encoding="utf-8"
        )
    )
    canonical = json.dumps(
        corpus, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode()
    if hashlib.sha256(canonical).hexdigest() != CORPUS_HASH:
        raise RuntimeError(
            "The public evaluation corpus changed; review it before enabling live processing."
        )
    return {
        item["id"]: item["text"] for item in corpus["cases"] if item["source"] == "user"
    }


def _protect(data: bytes, decrypt: bool = False) -> bytes:
    if os.name != "nt":
        raise RuntimeError(
            "This local credential setup requires Windows user protection."
        )

    class Blob(ctypes.Structure):
        _fields_ = [("size", ctypes.c_ulong), ("data", ctypes.c_void_p)]
        size: int
        data: ctypes.c_void_p

    source = ctypes.create_string_buffer(data)
    entropy = ctypes.create_string_buffer(b"Contexify.public-assistant-evaluation.v1")
    input_blob = Blob(len(data), ctypes.cast(source, ctypes.c_void_p))
    entropy_blob = Blob(len(entropy.raw), ctypes.cast(entropy, ctypes.c_void_p))
    output = Blob()
    function = (
        ctypes.windll.crypt32.CryptUnprotectData
        if decrypt
        else ctypes.windll.crypt32.CryptProtectData
    )
    function.argtypes = [
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(Blob),
    ]
    function.restype = ctypes.c_int
    if not function(
        ctypes.byref(input_blob),
        None,
        ctypes.byref(entropy_blob),
        None,
        None,
        1,
        ctypes.byref(output),
    ):
        raise RuntimeError(
            "Windows credential protection failed; no live request was made."
        )
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        ctypes.windll.kernel32.LocalFree(output.data)


def save_project_key() -> None:
    from dotenv import get_key

    key = get_key(str(ROOT / "backend/.env"), "GEMINI_API_KEY")
    if not key or not key.strip() or len(key.strip()) > 512:
        raise RuntimeError(
            "Set a Gemini API key locally in backend/.env; do not paste it into chat."
        )
    STATE.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_bytes(_protect(key.strip().encode()))
    print(
        "Test credential protected for the current Windows user; no API request made."
    )


def load_key() -> str:
    if not KEY_FILE.is_file():
        raise RuntimeError("Prepare the protected test credential before live startup.")
    key = _protect(KEY_FILE.read_bytes(), decrypt=True).decode()
    if not key or len(key) > 512:
        raise RuntimeError("The protected test credential is invalid.")
    return key


def google_addresses() -> frozenset[str]:
    addresses = frozenset(
        str(row[4][0])
        for row in socket.getaddrinfo(GOOGLE_HOST, 443, type=socket.SOCK_STREAM)
    )
    if not addresses or any(
        not ipaddress.ip_address(value).is_global for value in addresses
    ):
        raise RuntimeError("The fixed Gemini host did not resolve to public addresses.")
    return addresses


def network_guard(addresses: frozenset[str]):
    def guard(event, args):
        if event == "socket.getaddrinfo":
            # AnyIO encodes DNS names before handing them to the OS resolver.
            host = args[0]
            if isinstance(host, bytes):
                host = host.decode("ascii", errors="replace")
            if host in (None, "localhost", "127.0.0.1", "::1"):
                return
            if host == GOOGLE_HOST and args[1] == 443:
                return
            raise PermissionError(
                "Only local connections and the fixed Gemini host are permitted."
            )
        if event == "socket.connect":
            address = args[1]
            if isinstance(address, tuple) and address[0] in ("127.0.0.1", "::1"):
                return
            if (
                isinstance(address, tuple)
                and address[0] in addresses
                and address[1] == 443
            ):
                return
            raise PermissionError(
                "Outbound destination is outside the approved evaluation scope."
            )

    return guard


class EvaluationBudget:
    """Hard daily attempt cap across restarts; not a billing/account control."""

    def __init__(self, path: Path, *, daily_limit: int = 20):
        if type(daily_limit) is not int or daily_limit not in (20, 30):
            raise ValueError("Unreviewed evaluation attempt limit.")
        self.path = path
        self.daily_limit = daily_limit

    def reserve(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=2)) as conn, conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS attempts(day TEXT NOT NULL, started REAL NOT NULL)"
            )
            conn.execute("BEGIN IMMEDIATE")
            today = time.strftime("%Y-%m-%d", time.gmtime())
            count = conn.execute(
                "SELECT COUNT(*) FROM attempts WHERE day=?", (today,)
            ).fetchone()[0]
            if count >= self.daily_limit:
                raise ProviderQuotaExceeded()
            conn.execute(
                "INSERT INTO attempts(day,started) VALUES(?,?)", (today, time.time())
            )
            conn.execute(
                "DELETE FROM attempts WHERE started<?", (time.time() - 14 * 86400,)
            )


class GoogleTransport(httpx.AsyncBaseTransport):
    def __init__(
        self,
        budget: EvaluationBudget,
        inner: httpx.AsyncBaseTransport | None = None,
        *,
        model: PlanningModel = MODEL,
    ):
        if model not in APPROVED_MODELS:
            raise ValueError("Unreviewed planning model.")
        self.model = model
        self.budget = budget
        self.inner = inner or httpx.AsyncHTTPTransport(
            retries=0,
            trust_env=False,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
        )
        self.last_status: int | None = None

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.last_status = None
        url = request.url
        if (
            request.method != "POST"
            or url.scheme != "https"
            or url.host != GOOGLE_HOST
            or url.port not in (None, 443)
            or url.username
            or url.password
            or url.query
            or url.path != f"/v1beta/models/{self.model}:generateContent"
        ):
            raise httpx.UnsupportedProtocol("Unapproved planning destination.")
        try:
            await asyncio.to_thread(self.budget.reserve)
        except (sqlite3.Error, OSError):
            raise httpx.TransportError(
                "Live evaluation admission is unavailable."
            ) from None
        response = await self.inner.handle_async_request(request)
        self.last_status = response.status_code
        try:
            if response.headers.get("content-encoding", "identity") != "identity":
                raise httpx.ProtocolError(
                    "Compressed planning responses are not accepted."
                )
            content = bytearray()
            async for chunk in response.aiter_raw():
                content.extend(chunk)
                if len(content) > 65536:
                    raise httpx.ProtocolError(
                        "Planning response exceeded its transport limit."
                    )
            return httpx.Response(
                response.status_code, headers=response.headers, content=bytes(content)
            )
        finally:
            await response.aclose()

    async def aclose(self) -> None:
        await self.inner.aclose()


class PublicEvaluationProvider(GeminiPlanningProvider):
    """Corpus lookup is an egress whitelist, never a phrase-to-action implementation."""

    def __init__(
        self,
        api_key: str,
        state: Path = STATE,
        *,
        model: PlanningModel = MODEL,
        flash_lite_evaluation: bool = False,
    ):
        self.cases = public_cases()
        super().__init__(
            approved_cases=self.cases,
            api_key=api_key,
            client_factory=self._make_client,
            model=model,
        )
        if flash_lite_evaluation and model != "gemini-3.5-flash-lite":
            raise ValueError(
                "The extended public evaluation budget requires Flash-Lite."
            )
        self.transport = GoogleTransport(
            EvaluationBudget(
                state / "attempts.sqlite3",
                daily_limit=30 if flash_lite_evaluation else 20,
            ),
            model=model,
        )
        self.sdk: Any = None
        self.http: httpx.AsyncClient | None = None

    def _approved(self, value: PlanningInput) -> PlanningInput:
        if value.synthetic_case_id is not None:
            return value
        # Only case, whitespace and one sentence-ending period may vary.
        # Always send the reviewed canonical text, never arbitrary original text.
        normalized = " ".join(value.text.strip().removesuffix(".").lower().split())
        for case_id, text in self.cases.items():
            if normalized == text.lower():
                return PlanningInput(text, case_id, value.platform)
        raise ProviderDataScopeError()

    def validate_input(self, value: PlanningInput) -> None:
        super().validate_input(self._approved(value))

    async def propose(
        self, value: PlanningInput, *, repair: bool, timeout: float
    ) -> str:
        return await super().propose(
            self._approved(value), repair=repair, timeout=timeout
        )

    def _make_client(self, *, api_key, http_options):
        from google import genai

        self.http = httpx.AsyncClient(
            transport=self.transport,
            trust_env=False,
            follow_redirects=False,
            timeout=30,
            headers={"Accept-Encoding": "identity"},
        )
        options = http_options.model_copy(
            update={
                "base_url": "https://" + GOOGLE_HOST,
                "api_version": "v1beta",
                "httpx_async_client": self.http,
                "client_args": {"trust_env": False, "follow_redirects": False},
            }
        )
        self.sdk = genai.Client(api_key=api_key, vertexai=False, http_options=options)
        return self.sdk

    async def aclose(self) -> None:
        try:
            await super().aclose()
        finally:
            if self.sdk is not None:
                self.sdk.close()
            if self.http is not None and not self.http.is_closed:
                await self.http.aclose()
            if self.http is None:
                await self.transport.aclose()
            self.sdk = None
            self.http = None


async def smoke(
    model: PlanningModel = MODEL, *, flash_lite_evaluation: bool = False
) -> int:
    from app.assistant.planning_engine import PlanningEngine

    sys.addaudithook(network_guard(google_addresses()))
    provider = PublicEvaluationProvider(
        load_key(), model=model, flash_lite_evaluation=flash_lite_evaluation
    )
    engine = PlanningEngine(provider, concurrency=1)
    results = []
    attempts = 0

    async def admit():
        nonlocal attempts
        if attempts >= 3:
            raise HTTPException(
                429, "The three-attempt evaluation budget is exhausted."
            )
        attempts += 1

    async def connected():
        return False

    try:
        for case_id in ("M0-01", "M0-07", "M0-11"):
            started = time.monotonic()
            value = await engine.generate(
                PlanningInput(provider.cases[case_id], case_id, "android"),
                authorize_attempt=admit,
                disconnected=connected,
            )
            passed = (
                (
                    value.status == "proposed"
                    and value.steps[0].action.capability_id == "media_volume.set"
                    and value.steps[0].action.percent == 50
                    and len(value.steps) == 1
                )
                if case_id == "M0-01"
                else (
                    value.status == "refused" and value.reason == "policy_limit"
                    if case_id == "M0-07"
                    else value.status == "non_action"
                    and value.reason == "not_a_command"
                )
            )
            results.append(
                {
                    "case_id": case_id,
                    "status": value.status,
                    "passed": passed,
                    **(
                        {"reason": value.reason}
                        if value.status != "proposed"
                        else {
                            "actions": [
                                step.action.model_dump() for step in value.steps
                            ]
                        }
                    ),
                    "seconds": round(time.monotonic() - started, 2),
                }
            )
            print(
                f"{case_id}: {'passed' if passed else 'failed'} ({value.status})",
                flush=True,
            )
            if not passed:
                break
    except (HTTPException, ProviderUnavailable, RuntimeError, ValueError) as error:
        print(
            "Live evaluation stopped:",
            type(error).__name__,
            "HTTP status:",
            provider.transport.last_status,
        )
        return 1
    finally:
        await provider.aclose()
        STATE.mkdir(parents=True, exist_ok=True)
        (STATE / f"smoke-report-{model}.json").write_text(
            json.dumps(
                {
                    "model": model,
                    "attempts": attempts,
                    "passed": len(results) == 3
                    and all(item["passed"] for item in results),
                    "provider_http_status": provider.transport.last_status,
                    "results": results,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    return 0 if len(results) == 3 and all(item["passed"] for item in results) else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--setup-key-from-project", action="store_true")
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--confirm-free-tier", action="store_true")
    parser.add_argument("--model", choices=APPROVED_MODELS, default=MODEL)
    parser.add_argument(
        "--flash-lite-evaluation",
        action="store_true",
        help="Explicitly approve up to 30 shared daily public-test attempts for Flash-Lite; does not change Google billing.",
    )
    args = parser.parse_args()
    if args.flash_lite_evaluation and args.model != "gemini-3.5-flash-lite":
        parser.error("--flash-lite-evaluation requires --model gemini-3.5-flash-lite.")
    if args.setup_key_from_project:
        save_project_key()
        return 0
    if not args.smoke or not args.confirm_free_tier:
        parser.error(
            "Live smoke needs --smoke --confirm-free-tier after checking the actual project billing state."
        )
    for name in ("google_genai", "httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    return asyncio.run(
        smoke(
            cast(PlanningModel, args.model),
            flash_lite_evaluation=args.flash_lite_evaluation,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
