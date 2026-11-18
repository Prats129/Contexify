"""Stable v2 identity/read-only recovery against disposable SQLite and loopback Turso."""

import base64
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor

import test_assistant_security as bootstrap
import test_assistant_volume as volume_tests

from app.db import database


class OperationTests(bootstrap.AssistantSecurityFixture):
    management: str
    device: str
    simulation: str
    api = volume_tests.AssistantVolumeTests.api
    prepare = volume_tests.AssistantVolumeTests.prepare
    path = volume_tests.AssistantVolumeTests.path
    authorize = volume_tests.AssistantVolumeTests.authorize
    claim_body = volume_tests.AssistantVolumeTests.claim_body

    def setUp(self):
        super().setUp()
        self.prepare()

    def identity(self, **changes):
        return {
            "protocol_version": 2,
            "plan_id": "11111111-1111-4111-8111-111111111111",
            "plan_revision": 1,
            "step_id": 0,
            **changes,
        }

    def create_operation(self, percent=50, **identity):
        return self.api(
            "POST",
            "/volume/operations",
            json={
                **self.identity(**identity),
                "action": {"capability_id": "media_volume.set", "percent": percent},
            },
        )

    def status(self, **identity):
        return self.api(
            "POST", "/volume/operations/status", json=self.identity(**identity)
        )

    def test_stable_identity_binds_arguments_and_step(self):
        first = self.create_operation()
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json(), self.create_operation().json())
        self.assertEqual(self.create_operation(40).status_code, 409)
        second = self.create_operation(40, step_id=1)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertNotEqual(first.json()["task_id"], second.json()["task_id"])

    def test_native_recovery_identity_requires_a_current_authenticated_parent(self):
        response = self.api("POST", "/volume/operations/identity", json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["protocol_version"], 2)
        self.assertEqual(response.json()["installation_id"], self.installation)
        self.assertEqual(response.json()["public_key"], self.public_key)
        self.assertEqual(response.json()["origin"], "https://api.fixture.invalid")
        self.assertEqual(
            self.api(
                "POST", "/volume/operations/identity", token=self.other_token, json={}
            ).status_code,
            401,
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "DELETE FROM auth_sessions WHERE token_hash=?",
                (bootstrap.security.digest(self.token),),
            )
        self.assertEqual(
            self.api("POST", "/volume/operations/identity", json={}).status_code, 401
        )

    def test_read_only_reconciliation_does_not_transfer_v1_authority(self):
        task = self.create_operation().json()
        self.simulation = self.api(
            "POST", "/volume/sessions", token=self.management, json={}
        ).json()["access_token"]
        self.assertEqual(self.status().status_code, 200)
        self.assertEqual(self.api("GET", self.path(task)).status_code, 404)
        self.assertEqual(self.create_operation().status_code, 409)
        self.assertEqual(
            self.api(
                "POST",
                self.path(task) + "/authorization-challenge",
                json={"expected_revision": 1},
            ).status_code,
            404,
        )

    def test_claimed_operation_is_unknown_without_mutating_or_replaying(self):
        task = self.create_operation().json()
        claim = self.api(
            "POST",
            self.path(task) + "/claim",
            json=self.claim_body(self.authorize(task)),
        )
        self.assertEqual(claim.status_code, 200, claim.text)
        with database.get_db_connection() as conn:
            before = dict(
                self.database_row(
                    conn,
                    "SELECT * FROM assistant_volume_tasks WHERE id=?",
                    (task["task_id"],),
                )
            )
        for _ in range(2):
            response = self.status()
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["state"], "outcome_unknown")
            self.assertIsNone(response.json()["result"])
        with database.get_db_connection() as conn:
            after = dict(
                self.database_row(
                    conn,
                    "SELECT * FROM assistant_volume_tasks WHERE id=?",
                    (task["task_id"],),
                )
            )
        self.assertEqual(before, after)

    def test_expired_pending_status_is_a_read_only_projection(self):
        task = self.create_operation().json()
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_volume_tasks SET expires_at=? WHERE id=?",
                (time.time() - 1, task["task_id"]),
            )
        self.assertEqual(self.status().json()["state"], "expired")
        with database.get_db_connection() as conn:
            self.assertEqual(
                self.database_row(
                    conn,
                    "SELECT state FROM assistant_volume_tasks WHERE id=?",
                    (task["task_id"],),
                )["state"],
                "awaiting_confirmation",
            )

    def test_receipt_survives_scope_expiry_as_evidence_only(self):
        task = self.create_operation().json()
        claim = self.api(
            "POST",
            self.path(task) + "/claim",
            json=self.claim_body(self.authorize(task)),
        ).json()
        result = {
            "expected_revision": 3,
            "claim_id": claim["claim_id"],
            "outcome": "verified",
            "observed_index": 7,
            "max_index": 15,
        }
        challenge = self.api(
            "POST", self.path(task) + "/receipt-challenge", json=result
        )
        receipt = self.api(
            "POST",
            self.path(task) + "/receipt",
            json={**result, **self.proof(challenge.json())},
        )
        self.assertEqual(receipt.status_code, 200, receipt.text)
        self.simulation = self.api(
            "POST", "/volume/sessions", token=self.management, json={}
        ).json()["access_token"]
        self.assertEqual(self.status().json()["result"]["outcome"], "verified")
        self.assertEqual(self.api("GET", self.path(task)).status_code, 404)

    def test_recovery_rechecks_parent_and_device_revocation(self):
        self.create_operation()
        for token in (self.token, self.other_token, self.management):
            self.assertEqual(
                self.api(
                    "POST",
                    "/volume/operations/status",
                    token=token,
                    json=self.identity(),
                ).status_code,
                401,
            )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_devices SET revoked_at=? WHERE id=?",
                (time.time(), self.device),
            )
        self.assertEqual(self.status().status_code, 401)

    def test_other_device_cannot_read_a_known_operation_identity(self):
        self.create_operation()
        self.installation = str(uuid.uuid4())
        self.key = bootstrap.ec.generate_private_key(bootstrap.ec.SECP256R1())
        self.public_key = base64.b64encode(
            self.key.public_key().public_bytes(
                bootstrap.serialization.Encoding.X962,
                bootstrap.serialization.PublicFormat.UncompressedPoint,
            )
        ).decode()
        management = self.device_session(self.enroll())
        self.simulation = self.api(
            "POST", "/volume/sessions", token=management, json={}
        ).json()["access_token"]
        self.assertEqual(self.status().status_code, 404)

    def test_strict_v2_identity_and_compiled_scope(self):
        for changes in (
            {"protocol_version": 1},
            {"plan_revision": True},
            {"step_id": -1},
            {"step_id": 5},
            {"plan_id": "invalid"},
            {"extra": "forbidden"},
        ):
            self.assertEqual(
                self.api(
                    "POST", "/volume/operations/status", json=self.identity(**changes)
                ).status_code,
                422,
            )
        for action in (
            {"capability_id": "brightness.set_app", "percent": 50},
            {"capability_id": "media_volume.set", "percent": 90},
        ):
            self.assertEqual(
                self.api(
                    "POST",
                    "/volume/operations",
                    json={**self.identity(), "action": action},
                ).status_code,
                422,
            )

    def test_concurrent_duplicate_dispatch_reserves_one_task(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.create_operation(), range(2)))
        self.assertEqual([response.status_code for response in responses], [200, 200])
        self.assertEqual(responses[0].json()["task_id"], responses[1].json()["task_id"])

    def test_brightness_operation_retains_separate_scope(self):
        token = self.api(
            "POST", "/brightness/sessions", token=self.management, json={}
        ).json()["access_token"]
        response = self.api(
            "POST",
            "/brightness/operations",
            token=token,
            json={
                **self.identity(),
                "action": {"capability_id": "brightness.set_app", "percent": 40},
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            self.api(
                "POST",
                "/brightness/operations/status",
                token=token,
                json=self.identity(),
            ).status_code,
            200,
        )
        self.assertEqual(self.status().status_code, 404)


class TursoOperationTests(OperationTests):
    setUp = volume_tests.TursoAssistantVolumeTests.setUp


if __name__ == "__main__":
    unittest.main()
