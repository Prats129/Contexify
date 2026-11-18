"""M1: disposable accounts/SQLite/loopback Turso and fake providers; no live AI."""

import asyncio
import json
import os
import sqlite3
import time
import unittest
from collections.abc import Callable, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock, patch

import httpx
import test_assistant_security as bootstrap
from fastapi import HTTPException
from pydantic import ValidationError
from turso_http_fixture import TursoHTTPFixture

from app.assistant import planning
from app.assistant.planning_engine import (
    InvalidProposal,
    PlanningEngine,
    get_planning_engine,
    parse_proposal,
)
from app.assistant.planning_provider import (
    MODEL,
    GeminiPlanningProvider,
    PlanningInput,
    PlanningModel,
    ProviderDataScopeError,
    ProviderIncompleteOutput,
    ProviderQuotaExceeded,
    ProviderUnavailable,
)
from app.db import database
from app.db.turso_http import close_http_client
from app.main import app
from app.schemas.assistant import AssistantProposal
from app.schemas.assistant_planning import PlanningRequest

TEXT = "put my media sound halfway"
VOLUME_STEP = {"action": {"capability_id": "media_volume.set", "percent": 50}}
DRAFT = {
    "mode": "proposal",
    "status": "proposed",
    "steps": [VOLUME_STEP],
}
OUTPUT = json.dumps(DRAFT)


class FakeProvider:
    def __init__(
        self,
        outputs: Sequence[str | Exception] | None = None,
        after: Callable[[], None] | None = None,
    ):
        self.outputs: list[str | Exception] = list(outputs or [OUTPUT])
        self.after = after
        self.calls: list[tuple[PlanningInput, bool, float]] = []

    def validate_input(self, value: PlanningInput) -> None:
        pass

    async def propose(
        self, value: PlanningInput, *, repair: bool, timeout: float
    ) -> str:
        self.calls.append((value, repair, timeout))
        if self.after:
            self.after()
        output = self.outputs.pop(0)
        if isinstance(output, Exception):
            raise output
        return output


class AssistantPlanningTests(bootstrap.AssistantSecurityFixture):
    def setUp(self):
        super().setUp()
        self.prepare()

    def prepare(self):
        gate = patch.object(
            bootstrap.fixture.settings, "ASSISTANT_PLANNING_ENABLED", True, create=True
        )
        gate.start()
        self.addCleanup(gate.stop)
        self.device = self.enroll()
        self.management = self.device_session(self.device)
        self.provider = FakeProvider()
        self.engine = PlanningEngine(self.provider)
        app.dependency_overrides[get_planning_engine] = lambda: self.engine
        self.addCleanup(lambda: app.dependency_overrides.pop(get_planning_engine, None))
        response = self.send("POST", "/grants", json=self.consent())
        self.assertEqual(response.status_code, 200, response.text)
        self.grant = response.json()

    @staticmethod
    def consent():
        return {
            "consent": True,
            "consent_policy_version": 1,
            "data_scope": "synthetic_evaluation",
        }

    def send(self, method, path, token=None, **kwargs):
        async def operation():
            headers = kwargs.pop("headers", {})
            selected = self.management if token is None else token
            if selected:
                headers["Authorization"] = "Bearer " + selected
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://api.fixture.invalid",
            ) as client:
                return await client.request(
                    method,
                    "/api/v1/assistant/planning" + path,
                    headers=headers,
                    **kwargs,
                )

        return asyncio.run(operation())

    def body(self, **overrides):
        return {
            "grant_id": self.grant["grant_id"],
            "source": "user",
            "text": TEXT,
            "synthetic_case_id": "M0-01",
            **overrides,
        }

    def test_proposal_is_owner_bound_non_executable_and_not_persisted(self):
        response = self.send("POST", "/proposals", json=self.body())
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["execution"], "not_authorized")
        self.assertEqual(data["owner_user_id"], self.principal.user_id)
        self.assertEqual(data["owner_device_id"], self.device)
        self.assertEqual(data["proposal"]["mode"], "proposal")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertLessEqual(data["expires_at"], self.grant["expires_at"])
        with self.assertRaises(ValidationError):
            AssistantProposal.model_validate(data["proposal"])
        self.assertEqual(
            set(vars(self.provider.calls[0][0])),
            {"text", "synthetic_case_id", "platform"},
        )
        with database.get_db_connection() as conn:
            for table in (
                "assistant_tasks",
                "assistant_volume_tasks",
                "assistant_brightness_tasks",
            ):
                self.assertEqual(
                    conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()[
                        "count"
                    ],
                    0,
                )
            row = dict(
                conn.execute("SELECT * FROM assistant_planning_grants").fetchone()
            )
            self.assertNotIn(TEXT, json.dumps(row))
            self.assertNotIn("text", row)

    def test_catalog_does_not_claim_installed_native_support_or_app_execution(self):
        response = self.send(
            "GET", "/grants/" + self.grant["grant_id"] + "/capabilities"
        )
        self.assertEqual(response.status_code, 200)
        for entry in response.json():
            self.assertEqual(entry["native_availability"], "unverified")
            self.assertEqual(entry["execution"], "not_authorized")
            self.assertEqual(entry["confirmation"], "exact_transaction")
            if entry["capability_id"] == "application.open":
                self.assertEqual(entry["presentation"], "preview_only")
                self.assertEqual(entry["native_source_platforms"], [])

    def test_consent_is_strict_and_not_an_execution_credential(self):
        for value in [False, 1, "true", None]:
            self.assertEqual(
                self.send(
                    "POST", "/grants", json={**self.consent(), "consent": value}
                ).status_code,
                422,
            )
        for token in [self.token, self.other_token, self.grant["grant_id"]]:
            self.assertEqual(
                self.send(
                    "POST", "/grants", token=token, json=self.consent()
                ).status_code,
                401,
            )
        for field, value in [
            ("consent_policy_version", True),
            ("consent_policy_version", 2),
            ("data_scope", "private"),
        ]:
            self.assertEqual(
                self.send(
                    "POST", "/grants", json={**self.consent(), field: value}
                ).status_code,
                422,
            )

    def test_same_account_new_session_cannot_reuse_grant(self):
        other = self.device_session(self.device)
        self.assertEqual(
            self.send("POST", "/proposals", token=other, json=self.body()).status_code,
            404,
        )
        self.assertEqual(self.provider.calls, [])

    def test_revocation_expiry_and_policy_change_deny_planning(self):
        path = "/grants/" + self.grant["grant_id"] + "/revoke"
        self.assertEqual(self.send("POST", path, json={}).status_code, 200)
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 404
        )
        response = self.send("POST", "/grants", json=self.consent())
        self.grant = response.json()
        with patch.object(planning, "POLICY_VERSION", 2):
            self.assertEqual(
                self.send("POST", "/proposals", json=self.body()).status_code, 403
            )
        with database.get_db_connection(write=True) as conn:
            conn.execute("UPDATE assistant_planning_grants SET expires_at=0")
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 403
        )
        self.assertEqual(self.provider.calls, [])

    def test_flag_off_and_unconfigured_runtime_make_no_provider_call(self):
        with patch.object(
            bootstrap.fixture.settings, "ASSISTANT_PLANNING_ENABLED", False
        ):
            self.assertEqual(
                self.send("POST", "/proposals", json=self.body()).status_code, 404
            )
        app.dependency_overrides.pop(get_planning_engine)
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 503
        )
        self.assertEqual(self.provider.calls, [])

    def test_untrusted_and_invalid_input_are_rejected_without_echo(self):
        self.assertEqual(
            self.send(
                "POST", "/proposals", json=self.body(source="untrusted")
            ).status_code,
            403,
        )
        for extra in [
            {"text": " "},
            {"text": "x" * 1025},
            {"text": "\U0001f600" * 513},
            {"confirmed": True},
            {"source": "tool"},
        ]:
            response = self.send("POST", "/proposals", json=self.body(**extra))
            self.assertIn(response.status_code, (413, 422))
            self.assertNotIn("confirmed", response.text)
            self.assertNotIn(TEXT, response.text)
        self.assertEqual(self.provider.calls, [])

    def test_model_authority_and_policy_violations_never_get_repaired(self):
        for output in [
            {**DRAFT, "confirmed": True},
            {**DRAFT, "mode": "simulation"},
            {
                **DRAFT,
                "steps": [
                    {"action": {"capability_id": "media_volume.set", "percent": 90}}
                ],
            },
        ]:
            self.provider.outputs = [json.dumps(output)]
            self.provider.calls.clear()
            self.assertEqual(
                self.send("POST", "/proposals", json=self.body()).status_code, 502
            )
            self.assertEqual(len(self.provider.calls), 1)

    def test_schema_repair_is_bounded_and_no_raw_errors_escape(self):
        self.provider.outputs = ["not-json", OUTPUT]
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 200
        )
        self.assertEqual([call[1] for call in self.provider.calls], [False, True])
        self.provider.outputs = [RuntimeError("synthetic-private-marker")]
        response = self.send("POST", "/proposals", json=self.body())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("synthetic-private-marker", response.text)

    def test_quota_and_admission_do_not_retry(self):
        self.provider.outputs = [ProviderQuotaExceeded()]
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 429
        )
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 429
        )
        self.assertEqual(len(self.provider.calls), 1)
        self.provider.calls.clear()
        self.engine = PlanningEngine(self.provider)
        with patch.object(
            planning,
            "consume_budgets",
            side_effect=HTTPException(429, "fixture admission"),
        ) as admission:
            self.assertEqual(
                self.send("POST", "/proposals", json=self.body()).status_code, 429
            )
            admission.assert_called_once()
        self.assertEqual(self.provider.calls, [])

    def test_incomplete_generation_is_rejected_without_schema_repair(self):
        self.provider.outputs = [ProviderIncompleteOutput()]
        response = self.send("POST", "/proposals", json=self.body())
        self.assertEqual(response.status_code, 502)
        self.assertEqual(len(self.provider.calls), 1)
        self.assertIn("complete proposal", response.json()["detail"])

    def test_runtime_adapter_blocks_arbitrary_text_before_client_creation(self):
        factory = Mock()
        self.engine = PlanningEngine(
            GeminiPlanningProvider(
                approved_cases={"M0-01": TEXT}, client_factory=factory
            )
        )
        response = self.send(
            "POST", "/proposals", json=self.body(text="synthetic-private-marker")
        )
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("synthetic-private-marker", response.text)
        factory.assert_not_called()

    def test_interactive_request_cannot_claim_synthetic_approval(self):
        body = self.body()
        body.pop("synthetic_case_id")
        result = self.send("POST", "/proposals", json=body)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIsNone(self.provider.calls[0][0].synthetic_case_id)
        factory = Mock()
        self.engine = PlanningEngine(
            GeminiPlanningProvider(
                approved_cases={"M0-01": TEXT}, client_factory=factory
            )
        )
        result = self.send("POST", "/proposals", json=body)
        self.assertEqual(result.status_code, 403)
        factory.assert_not_called()

    def test_device_revocation_and_gate_change_invalidate_late_results(self):
        def revoke_device():
            with database.get_db_connection(write=True) as conn:
                conn.execute(
                    "UPDATE assistant_devices SET revoked_at=? WHERE id=?",
                    (time.time(), self.device),
                )

        self.provider.after = revoke_device
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 401
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_devices SET revoked_at=NULL WHERE id=?",
                (self.device,),
            )
        self.provider.outputs = [OUTPUT]
        self.provider.after = lambda: setattr(
            bootstrap.fixture.settings, "ASSISTANT_PLANNING_ENABLED", False
        )
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 404
        )

    def test_revoked_consent_during_generation_discards_late_result(self):
        def revoke():
            with database.get_db_connection(write=True) as conn:
                conn.execute(
                    "DELETE FROM assistant_planning_grants WHERE id=?",
                    (self.grant["grant_id"],),
                )

        self.provider.after = revoke
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 404
        )

    def test_logout_during_generation_discards_late_result(self):
        def logout():
            with database.get_db_connection(write=True) as conn:
                conn.execute(
                    "DELETE FROM auth_sessions WHERE token_hash=?",
                    (self.principal.token_hash,),
                )

        self.provider.after = logout
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 401
        )

    def test_web_cookie_csrf_origin_and_cross_user_isolation(self):
        cookie, csrf = self.web_session()
        headers = {
            "Cookie": bootstrap.service.COOKIE_NAME + "=" + cookie,
            "Origin": "https://web.fixture.invalid",
            "X-Contexify-Assistant": "1",
            "X-CSRF-Token": csrf,
        }
        self.assertEqual(
            self.send(
                "POST",
                "/grants",
                token="",
                headers={**headers, "X-CSRF-Token": "wrong"},
                json=self.consent(),
            ).status_code,
            403,
        )
        response = self.send(
            "POST", "/grants", token="", headers=headers, json=self.consent()
        )
        self.assertEqual(response.status_code, 200, response.text)
        web_grant = response.json()["grant_id"]
        result = self.send(
            "POST",
            "/proposals",
            token="",
            headers=headers,
            json=self.body(grant_id=web_grant),
        )
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIsNone(result.json()["owner_device_id"])
        self.assertEqual(
            self.send(
                "POST", "/proposals", token="", headers=headers, json=self.body()
            ).status_code,
            404,
        )
        other = self.request(
            "POST",
            "/web-session",
            self.other_token,
            origin="https://web.fixture.invalid",
            json={},
        )
        other_headers = {
            **headers,
            "Cookie": bootstrap.service.COOKIE_NAME
            + "="
            + other.cookies[bootstrap.service.COOKIE_NAME],
            "X-CSRF-Token": other.json()["csrf_token"],
        }
        self.assertEqual(
            self.send(
                "POST",
                "/proposals",
                token="",
                headers=other_headers,
                json=self.body(grant_id=web_grant),
            ).status_code,
            404,
        )


class TursoAssistantPlanningTests(AssistantPlanningTests):
    def setUp(self):
        bootstrap.AssistantSecurityFixture.setUp(self)
        path = database.DB_FILE
        server = TursoHTTPFixture(lambda: path)
        self.addCleanup(server.close)
        self.addCleanup(close_http_client)
        for key, value in {
            "DATABASE_TYPE": "turso",
            "TURSO_DATABASE_URL": server.url,
        }.items():
            changed = patch.object(bootstrap.fixture.settings, key, value)
            changed.start()
            self.addCleanup(changed.stop)
        database.init_db()
        self.prepare()


class PlanningEngineTests(unittest.IsolatedAsyncioTestCase):
    async def test_input_and_engine_limits_fail_closed(self):
        body = {
            "grant_id": "11111111-1111-4111-8111-111111111111",
            "source": "user",
            "synthetic_case_id": "public-case-1",
            "text": "x" * 1024,
        }
        self.assertEqual(len(PlanningRequest.model_validate(body).text), 1024)
        for text in ["x" * 1025, "\U0001f600" * 513, "\ud800", " "]:
            with self.assertRaises(ValidationError):
                PlanningRequest.model_validate({**body, "text": text})
        for concurrency in [True, 1.5, 0]:
            with self.assertRaises(ValueError):
                # Deliberately pass invalid runtime values to test the guard.
                PlanningEngine(concurrency=cast(int, concurrency))
        for timeout in [True, float("inf"), 31]:
            with self.assertRaises(ValueError):
                PlanningEngine(timeout=timeout)

    async def generate(self, engine, disconnected=None):
        return await engine.generate(
            PlanningInput(TEXT, "M0-01", "android"),
            authorize_attempt=AsyncMock(),
            disconnected=disconnected or AsyncMock(return_value=False),
        )

    async def test_feedback_is_a_terminal_non_action_not_a_retry(self):
        provider = FakeProvider(
            [
                json.dumps(
                    {
                        "mode": "proposal",
                        "status": "non_action",
                        "reason": "not_a_command",
                    }
                )
            ]
        )
        result = await self.generate(PlanningEngine(provider))
        self.assertEqual(result.status, "non_action")
        self.assertEqual(len(provider.calls), 1)

    async def test_parse_duplicate_huge_nonfinite_and_dependency_cycles(self):
        for value in [
            "x" * 8193,
            '{"mode":"proposal","mode":"simulation"}',
            '{"x":NaN}',
            json.dumps({**DRAFT, "steps": [{**VOLUME_STEP, "depends_on": [0]}]}),
        ]:
            with self.assertRaises(InvalidProposal):
                parse_proposal(value)

    async def test_invalid_output_stops_after_two_attempts(self):
        provider = FakeProvider(["broken", "broken"])
        with self.assertRaises(HTTPException) as caught:
            await self.generate(PlanningEngine(provider))
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(len(provider.calls), 2)

    async def test_disconnect_cancels_and_does_not_return_a_proposal(self):
        class Waiting(FakeProvider):
            async def propose(self, *args, **kwargs):
                await asyncio.sleep(100)
                return OUTPUT

        with self.assertRaises(HTTPException) as caught:
            await self.generate(PlanningEngine(Waiting()), AsyncMock(return_value=True))
        self.assertEqual(caught.exception.status_code, 499)

    async def test_deadline_holds_capacity_until_ignored_cancellation_settles(self):
        release, finished, started = asyncio.Event(), asyncio.Event(), asyncio.Event()

        class Waiting(FakeProvider):
            async def propose(self, *args, **kwargs):
                started.set()
                try:
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        await release.wait()
                    return OUTPUT
                finally:
                    finished.set()

        engine = PlanningEngine(Waiting(), timeout=0.2, concurrency=1)
        try:
            with self.assertRaises(HTTPException) as caught:
                await self.generate(engine)
            self.assertEqual(caught.exception.status_code, 504)
            self.assertTrue(started.is_set())
            with self.assertRaises(HTTPException) as caught:
                await self.generate(engine)
            self.assertEqual(caught.exception.status_code, 429)
        finally:
            release.set()
            if started.is_set():
                await asyncio.wait_for(finished.wait(), 1)
            await asyncio.sleep(0)
        self.assertEqual((await self.generate(engine)).status, "proposed")

    async def test_synthetic_corpus_drives_contract_expectations_not_a_language_lookup(
        self,
    ):
        cases = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "tests/fixtures/assistant-planner-evaluation.json"
            ).read_text()
        )["cases"]
        for case in cases:
            if case["expected"] == "propose":
                output = {**DRAFT, "steps": [{"action": case["action"]}]}
            else:
                output = {
                    "mode": "proposal",
                    "status": "needs_clarification",
                    "reason": "ambiguous_request",
                }
            parsed = parse_proposal(json.dumps(output))
            self.assertEqual(
                parsed.status,
                "proposed" if case["expected"] == "propose" else "needs_clarification",
            )


class GeminiAdapterTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        # SDK import/conformance is independent from event-loop timing tests.
        from google.genai import types

        cls.sdk_types = types

    async def test_default_model_is_the_reviewed_flash_lite_pin(self):
        self.assertEqual(MODEL, "gemini-3.5-flash-lite")
        provider = GeminiPlanningProvider(approved_cases={"M0-01": TEXT})
        self.assertEqual(provider.model, MODEL)
        await provider.aclose()

    async def test_flash_lite_has_an_explicit_fixed_model_and_medium_thinking(self):
        generate = AsyncMock(
            return_value=SimpleNamespace(
                text=OUTPUT,
                function_calls=None,
                candidates=[SimpleNamespace(finish_reason="STOP")],
            )
        )
        close = AsyncMock()
        factory = Mock(
            return_value=SimpleNamespace(
                aio=SimpleNamespace(
                    models=SimpleNamespace(generate_content=generate), aclose=close
                )
            )
        )
        provider = GeminiPlanningProvider(
            approved_cases={"M0-01": TEXT},
            client_factory=factory,
            model="gemini-3.5-flash-lite",
        )
        try:
            await provider.propose(
                PlanningInput(TEXT, "M0-01", "android"), repair=False, timeout=2
            )
            options = generate.call_args.kwargs
            self.assertEqual(options["model"], "gemini-3.5-flash-lite")
            self.assertEqual(
                options["config"].thinking_config.thinking_level,
                self.sdk_types.ThinkingLevel.MEDIUM,
            )
            self.assertEqual(options["config"].http_options.retry_options.attempts, 1)
            self.assertEqual(options["config"].max_output_tokens, 4096)
        finally:
            await provider.aclose()
        close.assert_awaited_once()

    async def test_incomplete_candidate_is_rejected_even_when_json_is_parseable(self):
        for reason in ("MAX_TOKENS", "SAFETY", None):
            for text in (OUTPUT, '{"mode":"proposal"'):
                with self.subTest(reason=reason, text_complete=text == OUTPUT):
                    generate = AsyncMock(
                        return_value=SimpleNamespace(
                            text=text,
                            function_calls=None,
                            candidates=[SimpleNamespace(finish_reason=reason)],
                        )
                    )
                    provider = GeminiPlanningProvider(
                        approved_cases={"M0-01": TEXT},
                        client_factory=Mock(
                            return_value=SimpleNamespace(
                                aio=SimpleNamespace(
                                    models=SimpleNamespace(generate_content=generate)
                                )
                            )
                        ),
                    )
                    with self.assertRaises(ProviderIncompleteOutput) as caught:
                        await provider.propose(
                            PlanningInput(TEXT, "M0-01", "android"),
                            repair=False,
                            timeout=1,
                        )
                    self.assertEqual(str(caught.exception), "")
                    generate.assert_awaited_once()

    async def test_unreviewed_model_is_rejected_before_client_construction(self):
        factory = Mock()
        with self.assertRaises(ValueError):
            GeminiPlanningProvider(
                approved_cases={"M0-01": TEXT},
                client_factory=factory,
                model=cast(PlanningModel, "unreviewed-model"),
            )
        factory.assert_not_called()

    async def test_sdk_config_is_json_only_one_attempt_and_no_tools(self):
        generate = AsyncMock(
            return_value=SimpleNamespace(
                text=OUTPUT,
                function_calls=None,
                candidates=[SimpleNamespace(finish_reason="STOP")],
            )
        )
        close = AsyncMock()
        factory = Mock(
            return_value=SimpleNamespace(
                aio=SimpleNamespace(
                    models=SimpleNamespace(generate_content=generate), aclose=close
                )
            )
        )
        cases = {"M0-01": TEXT}
        provider = GeminiPlanningProvider(
            approved_cases=cases, client_factory=factory, model="gemini-3.6-flash"
        )
        cases["M0-01"] = "not the reviewed text"
        value = PlanningInput(TEXT, "M0-01", "android")
        self.assertEqual(await provider.propose(value, repair=False, timeout=2), OUTPUT)
        config = generate.call_args.kwargs["config"]
        self.assertEqual(generate.call_args.kwargs["model"], "gemini-3.6-flash")
        self.assertEqual(config.http_options.retry_options.attempts, 1)
        self.assertEqual(config.http_options.timeout, 2000)
        self.assertTrue(config.automatic_function_calling.disable)
        self.assertEqual(
            config.thinking_config.thinking_level, self.sdk_types.ThinkingLevel.MINIMAL
        )
        self.assertFalse(config.thinking_config.include_thoughts)
        self.assertEqual(config.max_output_tokens, 1024)
        self.assertEqual(config.tools, [])
        self.assertEqual(config.response_mime_type, "application/json")
        schema = config.response_json_schema
        for keyword in ("discriminator", "const", "oneOf"):
            self.assertNotIn(f'"{keyword}":', json.dumps(schema))
        self.assertEqual(len(schema["anyOf"]), 2)
        definitions = schema["$defs"]
        self.assertEqual(
            definitions["PlanningActions"]["properties"]["mode"]["enum"], ["proposal"]
        )
        self.assertEqual(
            definitions["PlanningActions"]["properties"]["status"]["enum"], ["proposed"]
        )
        self.assertEqual(
            len(definitions["ProposalStep"]["properties"]["action"]["anyOf"]), 3
        )
        volume = definitions["VolumeAction"]["properties"]
        self.assertEqual(volume["capability_id"]["enum"], ["media_volume.set"])
        self.assertEqual(
            (volume["percent"]["minimum"], volume["percent"]["maximum"]), (0, 70)
        )
        self.assertEqual(
            json.loads(generate.call_args.kwargs["contents"]),
            {"command": TEXT, "repair_schema": False},
        )
        await provider.aclose()
        close.assert_awaited_once()
        with self.assertRaises(ProviderUnavailable):
            await provider.propose(value, repair=False, timeout=1)
        factory.assert_called_once()

    async def test_private_or_mislabeled_text_never_creates_an_sdk_client(self):
        factory = Mock()
        provider = GeminiPlanningProvider(
            approved_cases={"M0-01": TEXT}, client_factory=factory
        )
        for value in [
            PlanningInput("synthetic-private-marker", "M0-01", "android"),
            PlanningInput(TEXT, "M0-99", "web"),
            PlanningInput(TEXT, None, "android"),
        ]:
            with self.assertRaises(ProviderDataScopeError):
                await provider.propose(value, repair=False, timeout=1)
        factory.assert_not_called()

    async def test_sdk_quota_error_is_sanitized_and_not_retried(self):
        from google.genai.errors import ClientError

        error = ClientError(429, {"error": {"message": "synthetic-private-sdk-error"}})
        generate = AsyncMock(side_effect=error)
        provider = GeminiPlanningProvider(
            approved_cases={"M0-01": TEXT},
            client_factory=Mock(
                return_value=SimpleNamespace(
                    aio=SimpleNamespace(
                        models=SimpleNamespace(generate_content=generate)
                    )
                )
            ),
        )
        with self.assertRaises(ProviderQuotaExceeded) as caught:
            await provider.propose(
                PlanningInput(TEXT, "M0-01", "android"), repair=False, timeout=1
            )
        self.assertEqual(str(caught.exception), "")
        generate.assert_awaited_once()

    async def test_sdk_service_transport_and_conversion_errors_are_sanitized(self):
        from aiohttp import ClientConnectionError
        from google.genai.errors import ServerError

        marker = "synthetic-private-sdk-error"
        for error in [
            ServerError(503, {"error": {"message": marker}}),
            httpx.ConnectError(marker),
            httpx.ReadTimeout(marker),
            ClientConnectionError(marker),
            TimeoutError(marker),
            ValueError(marker),
            TypeError(marker),
            RuntimeError(marker),
        ]:
            with self.subTest(error_type=type(error).__name__):
                generate = AsyncMock(side_effect=error)
                provider = GeminiPlanningProvider(
                    approved_cases={"M0-01": TEXT},
                    client_factory=Mock(
                        return_value=SimpleNamespace(
                            aio=SimpleNamespace(
                                models=SimpleNamespace(generate_content=generate)
                            )
                        )
                    ),
                )
                with self.assertRaises(ProviderUnavailable) as caught:
                    await provider.propose(
                        PlanningInput(TEXT, "M0-01", "android"), repair=False, timeout=1
                    )
                self.assertNotIsInstance(caught.exception, ProviderQuotaExceeded)
                self.assertEqual(str(caught.exception), "")
                generate.assert_awaited_once()

    async def test_no_implicit_environment_key_or_tool_call_execution(self):
        from google import genai

        provider = GeminiPlanningProvider(approved_cases={"M0-01": TEXT})
        with (
            patch.dict(os.environ, {"GEMINI_API_KEY": "fixture-must-not-load"}),
            patch.object(genai, "Client") as factory,
        ):
            with self.assertRaises(ProviderUnavailable):
                await provider.propose(
                    PlanningInput(TEXT, "M0-01", "android"), repair=False, timeout=1
                )
            factory.assert_not_called()
        generate = AsyncMock(
            return_value=SimpleNamespace(function_calls=[{"name": "untrusted_tool"}])
        )
        provider = GeminiPlanningProvider(
            approved_cases={"M0-01": TEXT},
            client_factory=Mock(
                return_value=SimpleNamespace(
                    aio=SimpleNamespace(
                        models=SimpleNamespace(generate_content=generate)
                    )
                )
            ),
        )
        with self.assertRaises(ProviderUnavailable):
            await provider.propose(
                PlanningInput(TEXT, "M0-01", "android"), repair=False, timeout=1
            )
        generate.assert_awaited_once()


class PlanningMigrationTests(unittest.TestCase):
    def test_v4_upgrade_rollback_and_restore_preserve_existing_control_records(self):
        from app.db.assistant_migrations import (
            _migrate_brightness_v4,
            migrate_assistant_security,
        )

        with sqlite3.connect(":memory:") as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("CREATE TABLE users(id TEXT PRIMARY KEY)")
            conn.execute(
                "CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT)"
            )
            _migrate_brightness_v4(conn)
            conn.execute("INSERT INTO users VALUES('fixture-user')")
            conn.execute(
                "INSERT INTO assistant_devices VALUES('fixture-device','fixture-user','fixture-installation',"
                "'fixture-key','android','https://api.fixture.invalid',1,NULL)"
            )
            conn.execute(
                "INSERT INTO assistant_volume_tasks "
                "(id,session_hash,user_id,device_id,idempotency_key,percent,policy_version,state,revision,created_at,expires_at) "
                "VALUES('fixture-task','fixture-hash','fixture-user','fixture-device','fixture-idempotency',50,1,'verified',4,1,2)"
            )
            conn.commit()
            conn.execute("BEGIN IMMEDIATE")
            migrate_assistant_security(conn)
            conn.rollback()
            self.assertEqual(
                conn.execute(
                    "SELECT MAX(version) FROM assistant_schema_versions"
                ).fetchone()[0],
                4,
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT name FROM sqlite_master WHERE name='assistant_planning_grants'"
                ).fetchone()
            )
            migrate_assistant_security(conn)
            migrate_assistant_security(conn)
            conn.commit()
            self.assertEqual(
                conn.execute(
                    "SELECT MAX(version) FROM assistant_schema_versions"
                ).fetchone()[0],
                5,
            )
            self.assertEqual(
                tuple(
                    conn.execute(
                        "SELECT percent,state FROM assistant_volume_tasks"
                    ).fetchone()
                ),
                (50, "verified"),
            )
            self.assertEqual(
                conn.execute("SELECT public_key FROM assistant_devices").fetchone()[0],
                "fixture-key",
            )
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])
            with sqlite3.connect(":memory:") as restored:
                conn.backup(restored)
                self.assertEqual(
                    restored.execute(
                        "SELECT percent FROM assistant_volume_tasks"
                    ).fetchone()[0],
                    50,
                )


if __name__ == "__main__":
    unittest.main()
