"""Synthetic signed handoffs on disposable SQLite and loopback Turso only."""

import json
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import test_assistant_security as bootstrap
import test_assistant_volume as volume_tests

from app.assistant import application
from app.db import database


class ApplicationTests(bootstrap.AssistantSecurityFixture):
    api = volume_tests.AssistantVolumeTests.api
    claim_body = volume_tests.AssistantVolumeTests.claim_body

    def setUp(self):
        super().setUp()
        self.prepare()

    def prepare(self):
        enabled = patch.object(
            bootstrap.fixture.settings, "ASSISTANT_EXECUTION_ENABLED", True, create=True
        )
        enabled.start()
        self.addCleanup(enabled.stop)
        self.device = self.enroll()
        self.management = self.device_session(self.device)
        self.volume_token = self.api(
            "POST", "/volume/sessions", token=self.management, json={}
        ).json()["access_token"]
        response = self.api(
            "POST", "/application/sessions", token=self.management, json={}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["scope"], "assistant:application")
        self.simulation = response.json()["access_token"]

    def identity(self, **changes):
        return {
            "protocol_version": 2,
            "plan_id": "11111111-1111-4111-8111-111111111111",
            "plan_revision": 1,
            "step_id": 0,
            **changes,
        }

    def create(self, action=None, **identity):
        return self.api(
            "POST",
            "/application/operations",
            json={
                **self.identity(**identity),
                "action": action
                or {
                    "capability_id": "application.open",
                    "application_id": "spotify",
                    "package_id": "com.spotify.music",
                },
            },
        )

    def path(self, task):
        return "/application/tasks/" + task["task_id"]

    def authorize(self, task):
        response = self.api(
            "POST",
            self.path(task) + "/authorization-challenge",
            json={"expected_revision": 1},
        )
        self.assertEqual(response.status_code, 200, response.text)
        fields = json.loads(response.json()["payload"])
        self.assertEqual(fields["mode"], "application")
        self.assertEqual(json.loads(fields["arguments_json"]), task["action"])
        response = self.api(
            "POST",
            self.path(task) + "/authorize",
            json={"expected_revision": 1, **self.proof(response.json())},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def status(self, **identity):
        return self.api(
            "POST", "/application/operations/status", json=self.identity(**identity)
        )

    def test_round_trip_reports_handoff_without_claiming_delivery(self):
        task = self.create().json()
        body = self.claim_body(self.authorize(task))
        claim = self.api("POST", self.path(task) + "/claim", json=body)
        self.assertEqual(claim.status_code, 200, claim.text)
        self.assertEqual(claim.json()["execution"], "android_application_handoff")
        self.assertEqual(
            self.api("POST", self.path(task) + "/claim", json=body).status_code, 409
        )
        result = {
            "expected_revision": 3,
            "claim_id": claim.json()["claim_id"],
            "outcome": "handoff_requested",
        }
        challenge = self.api(
            "POST", self.path(task) + "/receipt-challenge", json=result
        )
        self.assertEqual(challenge.status_code, 200, challenge.text)
        receipt = {**result, **self.proof(challenge.json())}
        response = self.api("POST", self.path(task) + "/receipt", json=receipt)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["result"], {"outcome": "handoff_requested"})
        self.assertEqual(
            self.api("POST", self.path(task) + "/receipt", json=receipt).status_code,
            409,
        )
        self.assertEqual(self.create().json()["state"], "handoff_requested")

    def test_only_catalog_pairs_are_accepted_without_intents_or_extras(self):
        for step, package in enumerate(
            (
                "com.google.android.deskclock",
                "com.android.deskclock",
                "com.sec.android.app.clockpackage",
            )
        ):
            response = self.create(
                {
                    "capability_id": "application.open",
                    "application_id": "clock",
                    "package_id": package,
                },
                step_id=step,
            )
            self.assertEqual(response.status_code, 200, response.text)
        valid = {
            "capability_id": "application.open",
            "application_id": "spotify",
            "package_id": "com.spotify.music",
        }
        for action in (
            {**valid, "package_id": "com.evil.app"},
            {**valid, "application_id": "clock"},
            {**valid, "intent": "android.intent.action.CALL"},
            {**valid, "extras": {"uri": "tel:123"}},
            {**valid, "schema_version": 2},
            {**valid, "percent": 50},
            {"capability_id": "application.open", "application_id": "spotify"},
        ):
            self.assertEqual(self.create(action).status_code, 422)

    def test_scope_parent_owner_device_and_shared_execution_gate(self):
        for token in (self.token, self.other_token, self.management, self.volume_token):
            self.assertEqual(
                self.api(
                    "POST",
                    "/application/operations/status",
                    token=token,
                    json=self.identity(),
                ).status_code,
                401,
            )
        with patch.object(
            bootstrap.fixture.settings, "ASSISTANT_EXECUTION_ENABLED", False
        ):
            self.assertEqual(self.create().status_code, 404)
        self.create()
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_devices SET revoked_at=? WHERE id=?",
                (time.time(), self.device),
            )
        self.assertEqual(self.status().status_code, 401)

    def test_changed_handler_idempotency_and_policy_cannot_reuse_approval(self):
        task = self.create().json()
        self.assertEqual(self.create().json(), task)
        self.assertEqual(
            self.create(
                {
                    "capability_id": "application.open",
                    "application_id": "clock",
                    "package_id": "com.android.deskclock",
                }
            ).status_code,
            409,
        )
        body = self.claim_body(self.authorize(task))
        with patch.object(application, "POLICY_VERSION", 2):
            self.assertEqual(
                self.api("POST", self.path(task) + "/claim", json=body).status_code, 409
            )

    def test_cancel_before_claim_prevents_launch_authority(self):
        task = self.create().json()
        body = self.claim_body(self.authorize(task))
        self.assertEqual(
            self.api("POST", self.path(task) + "/cancel", json={}).json()["state"],
            "cancelled",
        )
        self.assertEqual(
            self.api("POST", self.path(task) + "/claim", json=body).status_code, 409
        )

    def test_concurrent_claim_has_one_winner(self):
        task = self.create().json()
        body = self.claim_body(self.authorize(task))
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(
                pool.map(
                    lambda _: self.api("POST", self.path(task) + "/claim", json=body),
                    range(2),
                )
            )
        self.assertEqual(sorted(r.status_code for r in responses), [200, 409])

    def test_unknown_recovery_reads_without_mutating_or_transferring_claim_scope(self):
        task = self.create().json()
        self.api(
            "POST",
            self.path(task) + "/claim",
            json=self.claim_body(self.authorize(task)),
        )
        with database.get_db_connection() as conn:
            before = dict(
                self.database_row(
                    conn,
                    "SELECT * FROM assistant_application_tasks WHERE id=?",
                    (task["task_id"],),
                )
            )
        self.simulation = self.api(
            "POST", "/application/sessions", token=self.management, json={}
        ).json()["access_token"]
        self.assertEqual(self.status().json()["state"], "outcome_unknown")
        self.assertEqual(self.api("GET", self.path(task)).status_code, 404)
        self.assertEqual(self.create().status_code, 409)
        with database.get_db_connection() as conn:
            after = dict(
                self.database_row(
                    conn,
                    "SELECT * FROM assistant_application_tasks WHERE id=?",
                    (task["task_id"],),
                )
            )
        self.assertEqual(before, after)

    def test_receipt_cannot_invent_verified_playback_or_change_signed_result(self):
        task = self.create().json()
        claim = self.api(
            "POST",
            self.path(task) + "/claim",
            json=self.claim_body(self.authorize(task)),
        ).json()
        result = {
            "expected_revision": 3,
            "claim_id": claim["claim_id"],
            "outcome": "handoff_requested",
        }
        self.assertEqual(
            self.api(
                "POST",
                self.path(task) + "/receipt-challenge",
                json={**result, "outcome": "verified"},
            ).status_code,
            422,
        )
        challenge = self.api(
            "POST", self.path(task) + "/receipt-challenge", json=result
        ).json()
        self.assertEqual(
            self.api(
                "POST",
                self.path(task) + "/receipt",
                json={**result, "outcome": "failed", **self.proof(challenge)},
            ).status_code,
            409,
        )


class TursoApplicationTests(ApplicationTests):
    setUp = volume_tests.TursoAssistantVolumeTests.setUp


if __name__ == "__main__":
    unittest.main()
