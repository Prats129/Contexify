"""M7 public-only AI proposals; disposable auth/DB and mocked Gemini, never live."""

import json
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
import test_assistant_planning as planning_fixture
import test_assistant_security as bootstrap

from app.assistant import planning
from app.assistant.communication_evaluation import (
    COMMUNICATION_CASES,
    approved_communication_input,
)
from app.assistant.planning_engine import (
    InvalidProposal,
    parse_proposal,
)
from app.assistant.planning_provider import (
    CommunicationPlanningInput,
    GeminiPlanningProvider,
    PlanningInput,
    ProviderDataScopeError,
)
from app.assistant.public_evaluation import PublicEvaluationProvider
from app.db import database
from app.schemas.assistant_communication import CommunicationProposal

DRAFT = {
    "protocol_version": 1,
    "mode": "proposal",
    "status": "communication_proposed",
    "capability_id": "communication.compose",
    "request_kind": "sms",
    "recipient": "local_picker",
    "message": "This is a Contexify test.",
}


class CommunicationPlanningTests(bootstrap.AssistantSecurityFixture):
    provider: planning_fixture.FakeProvider
    device: str
    management: str
    grant: dict
    prepare = planning_fixture.AssistantPlanningTests.prepare
    consent = staticmethod(planning_fixture.AssistantPlanningTests.consent)
    send = planning_fixture.AssistantPlanningTests.send

    def setUp(self):
        super().setUp()
        self.prepare()
        self.provider.outputs = [json.dumps(DRAFT)]

    def body(self, **overrides):
        return {
            "grant_id": self.grant["grant_id"],
            "source": "user",
            "text": COMMUNICATION_CASES["M7-03"],
            "synthetic_case_id": "M7-03",
            **overrides,
        }

    def proposal(self, **overrides):
        return self.send(
            "POST", "/communication-proposals", json=self.body(**overrides)
        )

    def test_owner_bound_proposal_has_no_recipient_or_execution_authority(self):
        result = self.proposal()
        self.assertEqual(result.status_code, 200, result.text)
        data = result.json()
        self.assertEqual(data["execution"], "not_authorized")
        self.assertEqual(data["owner_user_id"], self.principal.user_id)
        self.assertEqual(data["owner_device_id"], self.device)
        self.assertLessEqual(data["expires_at"], self.grant["expires_at"])
        self.assertEqual(data["proposal"], DRAFT)
        self.assertEqual(result.headers["cache-control"], "no-store")
        value = self.provider.calls[0][0]
        self.assertIsInstance(value, CommunicationPlanningInput)
        self.assertEqual(set(vars(value)), {"text", "synthetic_case_id", "platform"})
        with database.get_db_connection() as conn:
            for table in (
                "assistant_tasks",
                "assistant_volume_tasks",
                "assistant_brightness_tasks",
            ):
                self.assertEqual(
                    conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"],
                    0,
                )
            self.assertNotIn(
                DRAFT["message"],
                json.dumps(
                    dict(
                        conn.execute(
                            "SELECT * FROM assistant_planning_grants"
                        ).fetchone()
                    )
                ),
            )

    def test_private_untrusted_or_mismatched_case_never_reaches_provider_or_budget(
        self,
    ):
        for values in (
            {"text": "text my private friend a private message"},
            {
                "text": COMMUNICATION_CASES["M7-03"].replace(
                    "Contexify test", "private text"
                )
            },
            {"synthetic_case_id": "M7-01"},
            {"source": "untrusted"},
            {"number": "+12025550123"},
            {"confirmed": True},
        ):
            with (
                self.subTest(values=values),
                patch.object(planning, "admit_attempt") as admit,
            ):
                result = self.proposal(**values)
                self.assertIn(result.status_code, (403, 422))
                admit.assert_not_called()
        self.assertEqual(self.provider.calls, [])

    def test_endpoint_canonicalizes_only_reviewed_text(self):
        result = self.proposal(
            text='  DRAFT  a text saying "This is a Contexify test." for a contact I choose.  ',
            synthetic_case_id=None,
        )
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.provider.calls[0][0].text, COMMUNICATION_CASES["M7-03"])
        self.assertEqual(self.provider.calls[0][0].synthetic_case_id, "M7-03")

    def test_auth_grant_session_and_gate_are_required(self):
        for token, expected in (
            (self.token, 401),
            (self.other_token, 401),
            (self.device_session(self.device), 404),
        ):
            result = self.send(
                "POST", "/communication-proposals", token=token, json=self.body()
            )
            self.assertEqual(result.status_code, expected)
        with patch.object(
            bootstrap.fixture.settings, "ASSISTANT_PLANNING_ENABLED", False
        ):
            self.assertEqual(self.proposal().status_code, 404)
        with database.get_db_connection(write=True) as conn:
            conn.execute("UPDATE assistant_planning_grants SET expires_at=0")
        self.assertEqual(self.proposal().status_code, 403)
        self.assertEqual(self.provider.calls, [])

    def reject_after(self, statement):
        def revoke():
            with database.get_db_connection(write=True) as conn:
                conn.execute(statement)

        self.provider.after = revoke
        self.assertIn(self.proposal().status_code, (401, 403, 404))

    def test_late_consent_revocation_discards_proposal(self):
        self.reject_after("DELETE FROM assistant_planning_grants")

    def test_late_device_revocation_discards_proposal(self):
        self.reject_after("UPDATE assistant_devices SET revoked_at=1")

    def test_late_logout_discards_proposal(self):
        self.reject_after("DELETE FROM auth_sessions")

    def test_late_grant_expiry_discards_proposal(self):
        self.reject_after("UPDATE assistant_planning_grants SET expires_at=0")

    def test_schema_rejects_recipient_authority_and_message_invention_without_repair(
        self,
    ):
        for extra in (
            {"number": "+12025550123"},
            {"recipient": "+12025550123"},
            {"confirmed": True},
            {"execution": "authorized"},
            {"request_kind": "send_sms"},
            {"message": "invented content"},
            {"message": "\u202eevil"},
        ):
            self.provider.outputs = [json.dumps({**DRAFT, **extra})]
            self.provider.calls.clear()
            result = self.proposal()
            self.assertEqual(result.status_code, 502, result.text)
            self.assertEqual(len(self.provider.calls), 1)

    def test_missing_body_clarifies_locally_and_feedback_does_not_retry(self):
        for output in (
            {**DRAFT, "message": None},
            {
                "protocol_version": 1,
                "mode": "proposal",
                "status": "non_action",
                "reason": "not_a_command",
            },
            {
                "protocol_version": 1,
                "mode": "proposal",
                "status": "unsupported",
                "reason": "unsupported_request",
            },
        ):
            self.provider.outputs = [json.dumps(output)]
            self.provider.calls.clear()
            result = self.proposal(
                text=COMMUNICATION_CASES["M7-10"], synthetic_case_id="M7-10"
            )
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(len(self.provider.calls), 1)

    def test_settings_and_communication_schemas_cannot_cross_routes(self):
        self.provider.outputs = [planning_fixture.OUTPUT]
        self.assertEqual(self.proposal().status_code, 502)
        self.provider.outputs = [json.dumps(DRAFT)]
        self.assertEqual(
            self.send("POST", "/proposals", json=self.body()).status_code, 502
        )

    def test_both_routes_share_admission_and_provider_quota_stop(self):
        from fastapi import HTTPException

        from app.assistant.planning_provider import ProviderQuotaExceeded

        with patch.object(
            planning,
            "consume_budgets",
            side_effect=HTTPException(429, "fixture budget"),
        ) as budget:
            self.assertEqual(self.proposal().status_code, 429)
            budget.assert_called_once()
        self.assertEqual(self.provider.calls, [])
        self.provider.outputs = [ProviderQuotaExceeded()]
        self.assertEqual(self.proposal().status_code, 429)
        self.provider.outputs = [planning_fixture.OUTPUT]
        self.assertEqual(
            self.send(
                "POST",
                "/proposals",
                json=self.body(text=planning_fixture.TEXT, synthetic_case_id="M0-01"),
            ).status_code,
            429,
        )
        self.assertEqual(len(self.provider.calls), 1)


class CommunicationContractTests(unittest.TestCase):
    def test_mobile_and_backend_share_the_same_reviewed_public_corpus(self):
        root = Path(__file__).resolve().parents[2]
        script = (
            "const {createTypeScriptLoader}=require('./tests/helpers/typescript_modules.cjs');"
            "const core=createTypeScriptLoader()('packages/assistant-core/src/index.ts');"
            "process.stdout.write(JSON.stringify(core.PUBLIC_COMMUNICATION_CASES));"
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(json.loads(result.stdout), dict(COMMUNICATION_CASES))

    def test_strict_message_and_dial_contract(self):
        for extra in (
            {"message": ""},
            {"message": "\ud800"},
            {"message": "😀" * 501},
            {"request_kind": "dial", "message": None},
        ):
            with self.assertRaises(InvalidProposal):
                parse_proposal(json.dumps({**DRAFT, **extra}), communications=True)
        self.assertIsInstance(
            parse_proposal(
                json.dumps({**DRAFT, "request_kind": "dial", "message": ""}),
                communications=True,
            ),
            CommunicationProposal,
        )

    def test_processing_scope_preserves_quoted_content_and_rejects_private_variants(
        self,
    ):
        for case_id, text in COMMUNICATION_CASES.items():
            self.assertEqual(approved_communication_input(text), (text, case_id))
        with self.assertRaises(ValueError):
            approved_communication_input(COMMUNICATION_CASES["M7-03"].lower())

    def test_public_provider_retains_schema_selection_and_original_settings_scope(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temporary:
            provider = PublicEvaluationProvider("synthetic-unused-key", Path(temporary))
            value = CommunicationPlanningInput(
                COMMUNICATION_CASES["M7-03"], None, "android"
            )
            approved = provider._approved(value)
            self.assertIsInstance(approved, CommunicationPlanningInput)
            provider.validate_input(value)
            self.assertEqual(len(provider.cases), 22)
            for invalid in (
                CommunicationPlanningInput("private message", "M7-03", "android"),
                PlanningInput(COMMUNICATION_CASES["M7-03"], "M7-03", "android"),
            ):
                with self.assertRaises(ProviderDataScopeError):
                    provider.validate_input(invalid)
            self.assertIsNone(provider.sdk)
            self.assertIsNone(provider.http)


class CommunicationGeminiTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_sdk_serializes_the_communication_schema_through_guarded_transport(
        self,
    ):
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temporary:
            provider = PublicEvaluationProvider(
                "fixture-not-an-api-key", Path(temporary)
            )
            calls = []

            def handle(request):
                calls.append(request)
                wire = json.loads(request.content)
                schema = wire["generationConfig"]["responseJsonSchema"]
                self.assertIn("CommunicationProposal", schema["$defs"])
                self.assertNotIn("PlanningActions", schema["$defs"])
                self.assertNotIn(
                    "number", schema["$defs"]["CommunicationProposal"]["properties"]
                )
                self.assertNotIn("tools", wire)
                command = json.loads(wire["contents"][0]["parts"][0]["text"])
                self.assertEqual(
                    command,
                    {"command": COMMUNICATION_CASES["M7-03"], "repair_schema": False},
                )
                response = {
                    "candidates": [
                        {
                            "content": {
                                "role": "model",
                                "parts": [{"text": json.dumps(DRAFT)}],
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
                output = await provider.propose(
                    CommunicationPlanningInput(
                        COMMUNICATION_CASES["M7-03"], None, "android"
                    ),
                    repair=False,
                    timeout=2,
                )
                self.assertEqual(json.loads(output), DRAFT)
                self.assertEqual(len(calls), 1)
            finally:
                await provider.aclose()

    async def test_sdk_uses_bounded_communication_schema_without_tools_or_retries(self):
        generate = AsyncMock(
            return_value=SimpleNamespace(
                text=json.dumps(DRAFT),
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
            approved_cases=COMMUNICATION_CASES, client_factory=factory
        )
        try:
            output = await provider.propose(
                CommunicationPlanningInput(
                    COMMUNICATION_CASES["M7-03"], "M7-03", "android"
                ),
                repair=False,
                timeout=2,
            )
            self.assertEqual(json.loads(output), DRAFT)
            options = generate.call_args.kwargs
            config = options["config"]
            self.assertEqual(config.tools, [])
            self.assertTrue(config.automatic_function_calling.disable)
            self.assertEqual(config.http_options.retry_options.attempts, 1)
            self.assertIn("local_picker", json.dumps(config.response_json_schema))
            self.assertNotIn(
                "media_volume.set", json.dumps(config.response_json_schema)
            )
            self.assertIn("Never supply a phone number", config.system_instruction)
            self.assertEqual(
                set(json.loads(options["contents"])), {"command", "repair_schema"}
            )
        finally:
            await provider.aclose()
        close.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
