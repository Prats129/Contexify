"""Public evaluation boundary tests; no configured application, real key or network."""

import asyncio
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.assistant import public_evaluation as live  # noqa: E402
from app.assistant.planning_provider import (  # noqa: E402
    PlanningInput,
    ProviderDataScopeError,
    ProviderQuotaExceeded,
    ProviderUnavailable,
)


class PublicEvaluationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="contexify-public-eval-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def attempts(self, budget):
        if not budget.path.is_file():
            return 0
        with closing(sqlite3.connect(budget.path)) as conn:
            return conn.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]

    async def test_only_reviewed_user_corpus_is_available(self):
        cases = live.public_cases()
        self.assertEqual(len(cases), 22)
        self.assertNotIn("M0-14", cases)
        with patch.object(live, "CORPUS_HASH", "unreviewed"):
            with self.assertRaises(RuntimeError):
                live.public_cases()
        self.assertNotIn("app.core.config", sys.modules)

    async def test_public_membership_is_checked_before_sdk_and_http(self):
        provider = live.PublicEvaluationProvider("fixture-not-an-api-key", self.root)
        try:
            for text, case_id in [
                ("synthetic-private-marker", None),
                ("set volume to 50% private suffix", None),
                ("set volume to 50%?", None),
                ("set volume to 50%", "wrong-case"),
            ]:
                with self.assertRaises(ProviderDataScopeError):
                    await provider.propose(
                        PlanningInput(text, case_id, "android"), repair=False, timeout=1
                    )
            self.assertIsNone(provider.sdk)
            self.assertIsNone(provider.http)
            self.assertEqual(self.attempts(provider.transport.budget), 0)
            normalized = provider._approved(
                PlanningInput("  Set volume to 50%.  ", None, "android")
            )
            self.assertEqual(normalized.text, "set volume to 50%")
            self.assertEqual(normalized.synthetic_case_id, "M0-05")
        finally:
            await provider.aclose()

    async def test_attempt_cap_survives_reconstruction_and_concurrency(self):
        budget = live.EvaluationBudget(self.root / "attempts.sqlite3")
        outcomes = await asyncio.gather(
            *[asyncio.to_thread(budget.reserve) for _ in range(24)],
            return_exceptions=True,
        )
        self.assertEqual(sum(value is None for value in outcomes), 20)
        self.assertEqual(
            sum(isinstance(value, ProviderQuotaExceeded) for value in outcomes), 4
        )
        self.assertEqual(self.attempts(budget), 20)
        with self.assertRaises(ProviderQuotaExceeded):
            live.EvaluationBudget(budget.path).reserve()

    async def test_extended_budget_is_explicit_bounded_and_uses_the_same_counter(self):
        budget = live.EvaluationBudget(self.root / "attempts.sqlite3", daily_limit=30)
        for _ in range(30):
            budget.reserve()
        self.assertEqual(self.attempts(budget), 30)
        for limit in (20, 30):
            with self.assertRaises(ProviderQuotaExceeded):
                live.EvaluationBudget(budget.path, daily_limit=limit).reserve()
        for limit in (0, 21, 31, True):
            with self.assertRaises(ValueError):
                live.EvaluationBudget(budget.path, daily_limit=limit)

    async def test_extended_evaluation_cannot_enable_an_unselected_or_unreviewed_model(
        self,
    ):
        with self.assertRaises(ValueError):
            live.PublicEvaluationProvider(
                "fixture-not-a-key",
                self.root,
                model="gemini-3.6-flash",
                flash_lite_evaluation=True,
            )
        provider = live.PublicEvaluationProvider(
            "fixture-not-a-key",
            self.root,
            model="gemini-3.5-flash-lite",
            flash_lite_evaluation=True,
        )
        try:
            self.assertEqual(provider.transport.budget.daily_limit, 30)
            self.assertEqual(provider.transport.model, provider.model)
            self.assertEqual(self.attempts(provider.transport.budget), 0)
        finally:
            await provider.aclose()

    async def test_network_guard_allows_only_local_and_pinned_google_tls(self):
        guard = live.network_guard(frozenset({"203.0.113.1"}))
        guard("socket.getaddrinfo", (live.GOOGLE_HOST, 443))
        guard("socket.getaddrinfo", (live.GOOGLE_HOST.encode("ascii"), 443))
        guard("socket.connect", (None, ("203.0.113.1", 443)))
        guard("socket.connect", (None, ("127.0.0.1", 8443)))
        for event, args in [
            ("socket.getaddrinfo", ("evil.invalid", 443)),
            ("socket.getaddrinfo", (b"evil.invalid", 443)),
            ("socket.getaddrinfo", (live.GOOGLE_HOST, 80)),
            ("socket.connect", (None, ("203.0.113.2", 443))),
            ("socket.connect", (None, ("203.0.113.1", 80))),
        ]:
            with self.assertRaises(PermissionError):
                guard(event, args)
        with patch.object(
            live.socket,
            "getaddrinfo",
            return_value=[(None, None, None, None, ("127.0.0.1", 443))],
        ):
            with self.assertRaises(RuntimeError):
                live.google_addresses()

    async def test_rotated_google_dns_is_revalidated_without_widening_egress(self):
        resolve = Mock(return_value=frozenset({"8.8.4.4"}))
        guard = live.network_guard(frozenset({"8.8.8.8"}), resolve=resolve)
        guard("socket.connect", (None, ("8.8.8.8", 443)))
        resolve.assert_not_called()
        guard("socket.connect", (None, ("8.8.4.4", 443)))
        resolve.assert_called_once()
        guard("socket.connect", (None, ("8.8.4.4", 443)))
        resolve.assert_called_once()
        with self.assertRaises(PermissionError):
            guard("socket.connect", (None, ("9.9.9.9", 443)))

    async def test_dns_refresh_failure_or_private_results_never_allow_connections(self):
        for value in (
            frozenset(),
            frozenset({"127.0.0.1", "8.8.4.4"}),
            OSError("synthetic-private-marker"),
        ):
            resolve = Mock(
                side_effect=value if isinstance(value, OSError) else None,
                return_value=value if not isinstance(value, OSError) else frozenset(),
            )
            guard = live.network_guard(frozenset({"8.8.8.8"}), resolve=resolve)
            with self.assertRaises(PermissionError):
                guard("socket.connect", (None, ("8.8.4.4", 443)))
        resolve = Mock(return_value=frozenset({"8.8.4.4"}))
        guard = live.network_guard(frozenset({"8.8.8.8"}), resolve=resolve)
        for target in (("192.168.0.1", 443), ("8.8.4.4", 80)):
            with self.assertRaises(PermissionError):
                guard("socket.connect", (None, target))
        resolve.assert_not_called()

    async def test_public_transport_diagnostics_never_log_private_error_text(self):
        marker = "synthetic-private-error-details"

        def fail(request):
            raise httpx.ConnectError(marker)

        transport = live.GoogleTransport(
            live.EvaluationBudget(self.root / "attempts.sqlite3"),
            httpx.MockTransport(fail),
        )
        try:
            with self.assertLogs(live.__name__, level="WARNING") as logs:
                with self.assertRaises(httpx.ConnectError):
                    await transport.handle_async_request(
                        httpx.Request(
                            "POST",
                            f"https://{live.GOOGLE_HOST}/v1beta/models/{live.MODEL}:generateContent",
                        )
                    )
            self.assertIn("ConnectError", " ".join(logs.output))
            self.assertNotIn(marker, " ".join(logs.output))
        finally:
            await transport.aclose()

    async def test_transport_rejects_arbitrary_urls_before_admission(self):
        budget = live.EvaluationBudget(self.root / "attempts.sqlite3")
        inner = httpx.MockTransport(
            lambda request: self.fail("No unapproved request may be sent")
        )
        transport = live.GoogleTransport(budget, inner)
        for url in [
            "http://generativelanguage.googleapis.com/",
            "https://evil.invalid/",
            f"https://{live.GOOGLE_HOST}:444/v1beta/models/{live.MODEL}:generateContent",
            f"https://{live.GOOGLE_HOST}/v1beta/models/other:generateContent",
            f"https://{live.GOOGLE_HOST}/v1beta/models/{live.MODEL}:generateContent?key=fixture",
        ]:
            with self.assertRaises(httpx.UnsupportedProtocol):
                await transport.handle_async_request(httpx.Request("POST", url))
        self.assertEqual(self.attempts(budget), 0)
        await transport.aclose()

    async def test_transport_bodies_are_bounded_and_no_compressed_expansion_is_allowed(
        self,
    ):
        budget = live.EvaluationBudget(self.root / "attempts.sqlite3")
        for headers, content in [
            ({}, b"x" * 65537),
            ({"Content-Encoding": "gzip"}, b"compressed"),
        ]:
            response = httpx.Response(
                200, headers=headers, stream=httpx.ByteStream(content)
            )
            transport = live.GoogleTransport(
                budget, httpx.MockTransport(lambda request: response)
            )
            with self.assertRaises(httpx.ProtocolError):
                await transport.handle_async_request(
                    httpx.Request(
                        "POST",
                        f"https://{live.GOOGLE_HOST}/v1beta/models/{live.MODEL}:generateContent",
                    )
                )
            self.assertTrue(response.is_closed)
            await transport.aclose()

    async def test_transport_and_budget_send_one_request_only(self):
        calls = []

        def handle(request):
            calls.append(request)
            return httpx.Response(200, stream=httpx.ByteStream(b'{"ok":true}'))

        budget = live.EvaluationBudget(self.root / "attempts.sqlite3")
        transport = live.GoogleTransport(budget, httpx.MockTransport(handle))
        result = await transport.handle_async_request(
            httpx.Request(
                "POST",
                f"https://{live.GOOGLE_HOST}/v1beta/models/{live.MODEL}:generateContent",
            )
        )
        self.assertEqual(result.json(), {"ok": True})
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.attempts(budget), 1)
        await transport.aclose()

    async def test_candidate_transport_does_not_allow_a_different_reviewed_model(self):
        budget = live.EvaluationBudget(self.root / "attempts.sqlite3")
        inner = httpx.MockTransport(
            lambda request: httpx.Response(200, stream=httpx.ByteStream(b"{}"))
        )
        transport = live.GoogleTransport(budget, inner, model="gemini-3.5-flash-lite")
        try:
            with self.assertRaises(httpx.UnsupportedProtocol):
                await transport.handle_async_request(
                    httpx.Request(
                        "POST",
                        f"https://{live.GOOGLE_HOST}/v1beta/models/gemini-3.6-flash:generateContent",
                    )
                )
            self.assertEqual(self.attempts(budget), 0)
            response = await transport.handle_async_request(
                httpx.Request(
                    "POST",
                    f"https://{live.GOOGLE_HOST}/v1beta/models/gemini-3.5-flash-lite:generateContent",
                )
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self.attempts(budget), 1)
        finally:
            await transport.aclose()

    async def test_smoke_repair_cannot_exceed_the_three_attempt_run_budget(self):
        proposal = json.dumps(
            {
                "mode": "proposal",
                "status": "proposed",
                "steps": [
                    {"action": {"capability_id": "media_volume.set", "percent": 50}}
                ],
            }
        )
        refused = json.dumps(
            {"mode": "proposal", "status": "refused", "reason": "policy_limit"}
        )
        provider = SimpleNamespace(
            cases=live.public_cases(),
            validate_input=Mock(),
            propose=AsyncMock(side_effect=["{", proposal, refused]),
            transport=SimpleNamespace(last_status=200),
            aclose=AsyncMock(),
        )
        with (
            patch.object(live, "PublicEvaluationProvider", return_value=provider),
            patch.object(live, "load_key", return_value="fixture-not-a-key"),
            patch.object(live, "google_addresses", return_value=frozenset()),
            patch.object(live.sys, "addaudithook"),
            patch.object(live, "STATE", self.root),
            redirect_stdout(io.StringIO()),
        ):
            result = await live.smoke("gemini-3.5-flash-lite")
        self.assertEqual(result, 1)
        self.assertEqual(provider.propose.await_count, 3)
        provider.aclose.assert_awaited_once()
        report = json.loads(
            (self.root / "smoke-report-gemini-3.5-flash-lite.json").read_text()
        )
        self.assertEqual(report["attempts"], 3)
        self.assertEqual(len(report["results"]), 2)
        self.assertFalse(report["passed"])

    async def test_unavailable_budget_blocks_egress_without_raw_errors(self):
        invalid = self.root / "not-a-directory"
        invalid.write_text("fixture")
        transport = live.GoogleTransport(
            live.EvaluationBudget(invalid / "attempts.sqlite3"),
            httpx.MockTransport(
                lambda request: self.fail("Do not send without accounting")
            ),
        )
        with self.assertRaises(httpx.TransportError) as caught:
            await transport.handle_async_request(
                httpx.Request(
                    "POST",
                    f"https://{live.GOOGLE_HOST}/v1beta/models/{live.MODEL}:generateContent",
                )
            )
        self.assertNotIn(str(self.root), str(caught.exception))
        await transport.aclose()

    async def test_sdk_factory_pins_host_httpx_and_closes_both_clients(self):
        from google import genai

        generate = AsyncMock(
            return_value=SimpleNamespace(
                text='{"mode":"proposal","status":"non_action","reason":"not_a_command"}',
                function_calls=None,
                candidates=[SimpleNamespace(finish_reason="STOP")],
            )
        )
        sdk = SimpleNamespace(
            aio=SimpleNamespace(
                models=SimpleNamespace(generate_content=generate), aclose=AsyncMock()
            ),
            close=Mock(),
        )
        provider = live.PublicEvaluationProvider("fixture-not-an-api-key", self.root)
        with patch.object(genai, "Client", return_value=sdk) as factory:
            await provider.propose(
                PlanningInput("Set volume to 50%.", None, "android"),
                repair=False,
                timeout=1,
            )
        options = factory.call_args.kwargs["http_options"]
        self.assertFalse(factory.call_args.kwargs["vertexai"])
        self.assertEqual(options.base_url, "https://" + live.GOOGLE_HOST)
        self.assertEqual(options.api_version, "v1beta")
        self.assertFalse(options.client_args["trust_env"])
        self.assertFalse(options.httpx_async_client.follow_redirects)
        self.assertEqual(
            options.httpx_async_client.headers["Accept-Encoding"], "identity"
        )
        self.assertIn(
            '"command": "set volume to 50%"', generate.call_args.kwargs["contents"]
        )
        await provider.aclose()
        self.assertTrue(options.httpx_async_client.is_closed)
        sdk.aio.aclose.assert_awaited_once()
        sdk.close.assert_called_once()
        with self.assertRaises(ProviderUnavailable):
            await provider.propose(
                PlanningInput("set volume to 50%", "M0-05", "android"),
                repair=False,
                timeout=1,
            )

    async def test_real_sdk_uses_the_guarded_transport_without_network(self):
        provider = live.PublicEvaluationProvider("fixture-not-an-api-key", self.root)
        calls = []

        def handle(request):
            calls.append(request)
            self.assertEqual(request.headers["Accept-Encoding"], "identity")
            body = json.loads(request.content)
            self.assertEqual(body["generationConfig"]["maxOutputTokens"], 4096)
            wire_schema = body["generationConfig"]["responseJsonSchema"]
            self.assertEqual(
                wire_schema["$defs"]["PlanningActions"]["properties"]["mode"]["enum"],
                ["proposal"],
            )
            self.assertNotIn("tools", body)
            command = json.loads(body["contents"][0]["parts"][0]["text"])
            self.assertEqual(
                command,
                {"command": "put my media sound halfway", "repair_schema": False},
            )
            response = {
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [
                                {
                                    "text": '{"mode":"proposal","status":"non_action","reason":"not_a_command"}'
                                }
                            ],
                        },
                        "finishReason": "STOP",
                    }
                ]
            }
            return httpx.Response(
                200, stream=httpx.ByteStream(json.dumps(response).encode())
            )

        await provider.transport.inner.aclose()
        provider.transport.inner = httpx.MockTransport(handle)
        try:
            result = await provider.propose(
                PlanningInput(provider.cases["M0-01"], "M0-01", "android"),
                repair=False,
                timeout=1,
            )
            self.assertEqual(json.loads(result)["status"], "non_action")
            self.assertEqual(len(calls), 1)
            self.assertEqual(self.attempts(provider.transport.budget), 1)
        finally:
            await provider.aclose()

    async def test_flash_lite_sdk_serializes_reasoning_and_prompt_to_the_fixed_endpoint(
        self,
    ):
        provider = live.PublicEvaluationProvider(
            "fixture-not-an-api-key", self.root, model="gemini-3.5-flash-lite"
        )

        def handle(request):
            self.assertEqual(
                request.url.path, "/v1beta/models/gemini-3.5-flash-lite:generateContent"
            )
            body = json.loads(request.content)
            self.assertEqual(
                body["generationConfig"]["thinkingConfig"]["thinking_level"], "MEDIUM"
            )
            instruction = body["systemInstruction"]["parts"][0]["text"]
            self.assertIn("Destination percentages and named fractions", instruction)
            self.assertIn("one quarter is an absolute 25% destination", instruction)
            response = {
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [
                                {
                                    "text": '{"mode":"proposal","status":"non_action","reason":"not_a_command"}'
                                }
                            ],
                        },
                        "finishReason": "STOP",
                    }
                ]
            }
            return httpx.Response(
                200, stream=httpx.ByteStream(json.dumps(response).encode())
            )

        await provider.transport.inner.aclose()
        provider.transport.inner = httpx.MockTransport(handle)
        try:
            await provider.propose(
                PlanningInput(provider.cases["M0-01"], "M0-01", "android"),
                repair=False,
                timeout=1,
            )
            self.assertEqual(self.attempts(provider.transport.budget), 1)
        finally:
            await provider.aclose()

    @unittest.skipUnless(os.name == "nt", "Windows user-bound credential protection")
    async def test_credential_roundtrip_is_protected_and_tampering_fails(self):
        fixture = b"fixture-not-an-api-key"
        protected = live._protect(fixture)
        self.assertNotIn(fixture, protected)
        self.assertEqual(live._protect(protected, decrypt=True), fixture)
        with self.assertRaises(RuntimeError):
            live._protect(b"not-a-protected-credential", decrypt=True)


if __name__ == "__main__":
    unittest.main()
