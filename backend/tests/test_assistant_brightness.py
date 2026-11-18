"""Synthetic accounts, disposable SQLite and loopback Turso; no configured backend."""

import json
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import test_assistant_core as core
import test_assistant_security as bootstrap
from turso_http_fixture import TursoHTTPFixture

from app.db import database
from app.db.turso_http import close_http_client


class AssistantBrightnessTests(bootstrap.AssistantSecurityFixture):
    api = core.AssistantCoreTests.api

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
        response = self.api(
            "POST", "/brightness/sessions", token=self.management, json={}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["scope"], "assistant:brightness")
        self.simulation = response.json()[
            "access_token"
        ]  # Common fixture's default bearer slot.

    def create(self, percent=50, key="synthetic-brightness-request"):
        return self.api(
            "POST",
            "/brightness/tasks",
            json={
                "idempotency_key": key,
                "action": {"capability_id": "brightness.set_app", "percent": percent},
            },
        )

    def path(self, task):
        return "/brightness/tasks/" + task["task_id"]

    def authorize(self, task):
        response = self.api(
            "POST",
            self.path(task) + "/authorization-challenge",
            json={"expected_revision": 1},
        )
        self.assertEqual(response.status_code, 200, response.text)
        challenge = response.json()
        self.assertEqual(json.loads(challenge["payload"])["mode"], "brightness")
        response = self.api(
            "POST",
            self.path(task) + "/authorize",
            json={"expected_revision": 1, **self.proof(challenge)},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def claim_body(self, permit):
        return {
            "expected_revision": 2,
            "permit": permit["permit"],
            **self.proof(permit["claim_challenge"]),
        }

    def test_round_trip_observation_and_idempotency(self):
        task = self.create().json()
        self.assertEqual(self.create().json(), task)
        self.assertEqual(self.create(40).status_code, 409)
        permit = self.authorize(task)
        response = self.api(
            "POST", self.path(task) + "/claim", json=self.claim_body(permit)
        )
        self.assertEqual(response.status_code, 200, response.text)
        claim = response.json()
        self.assertEqual(claim["execution"], "android_app_brightness")
        # Brightness readback uses 10,000 fixed window-attribute units.
        result = {
            "expected_revision": 3,
            "claim_id": claim["claim_id"],
            "outcome": "verified",
            "observed_index": 5000,
            "max_index": 10000,
        }
        response = self.api("POST", self.path(task) + "/receipt-challenge", json=result)
        self.assertEqual(response.status_code, 200, response.text)
        response = self.api(
            "POST",
            self.path(task) + "/receipt",
            json={**result, **self.proof(response.json())},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["state"], "verified")
        self.assertEqual(response.json()["result"]["observed_index"], 5000)
        self.assertEqual(self.create().json()["state"], "verified")

    def test_scope_isolation_and_platform(self):
        for token in [self.token, self.other_token, self.management]:
            self.assertEqual(
                self.api("POST", "/brightness/tasks", token=token, json={}).status_code,
                401,
            )
        self.assertEqual(
            self.api(
                "POST", "/simulation/sessions", token=self.simulation, json={}
            ).status_code,
            404,
        )
        self.assertEqual(
            self.request("GET", "/session", self.simulation).status_code, 401
        )
        self.assertEqual(
            self.account_fixture.request(
                "GET", "/user/me", self.simulation
            ).status_code,
            401,
        )
        with patch.object(
            bootstrap.fixture.settings,
            "ASSISTANT_SIMULATION_ENABLED",
            True,
            create=True,
        ):
            response = self.api(
                "POST", "/simulation/sessions", token=self.management, json={}
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(
                self.api(
                    "POST",
                    "/brightness/tasks",
                    token=response.json()["access_token"],
                    json={},
                ).status_code,
                401,
            )
            self.assertEqual(
                self.api("POST", "/simulation/tasks", json={}).status_code, 401
            )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_devices SET platform='ios' WHERE id=?", (self.device,)
            )
        self.assertEqual(
            self.api(
                "POST", "/brightness/sessions", token=self.management, json={}
            ).status_code,
            403,
        )
        self.assertEqual(self.create().status_code, 401)

    def test_strict_brightness_only_contracts_and_disabled_gate(self):
        for percent in [True, "50", 50.5, -1, 9, 101]:
            self.assertEqual(self.create(percent).status_code, 422)
        for action in [
            {"capability_id": "application.open", "application_id": "clock"},
            {
                "capability_id": "brightness.set_app",
                "percent": 50,
                "url": "https://private.invalid",
            },
        ]:
            self.assertEqual(
                self.api(
                    "POST",
                    "/brightness/tasks",
                    json={
                        "idempotency_key": "synthetic-brightness-request",
                        "action": action,
                    },
                ).status_code,
                422,
            )
        with patch.object(
            bootstrap.fixture.settings, "ASSISTANT_EXECUTION_ENABLED", False
        ):
            self.assertEqual(self.create().status_code, 404)
            self.assertEqual(
                self.api(
                    "POST", "/brightness/sessions", token=self.management, json={}
                ).status_code,
                404,
            )
        self.assertEqual(self.create(10).status_code, 200)
        self.assertEqual(
            self.create(100, "another-brightness-request").status_code, 200
        )

    def test_claim_is_atomic_and_not_replayable(self):
        task = self.create().json()
        body = self.claim_body(self.authorize(task))

        def claim(_):
            return self.api("POST", self.path(task) + "/claim", json=body).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(claim, range(2))), [200, 409])
        self.assertEqual(claim(None), 409)
        with database.get_db_connection() as conn:
            row = conn.execute(
                "SELECT permit_hash,state FROM assistant_brightness_tasks WHERE id=?",
                (task["task_id"],),
            ).fetchone()
            self.assertIsNone(row["permit_hash"])
            self.assertEqual(row["state"], "executing")

    def test_revocation_parent_logout_and_session_change(self):
        task = self.create().json()
        body = self.claim_body(self.authorize(task))
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_devices SET revoked_at=? WHERE id=?",
                (time.time(), self.device),
            )
        self.assertEqual(
            self.api("POST", self.path(task) + "/claim", json=body).status_code, 401
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_devices SET revoked_at=NULL WHERE id=?",
                (self.device,),
            )
            conn.execute(
                "DELETE FROM auth_sessions WHERE token_hash=?",
                (bootstrap.security.digest(self.token),),
            )
        self.assertEqual(self.create().status_code, 401)

    def test_signature_argument_binding_and_replaced_challenge(self):
        task = self.create().json()
        path = self.path(task)
        challenge = self.api(
            "POST", path + "/authorization-challenge", json={"expected_revision": 1}
        ).json()
        proof = {"expected_revision": 1, **self.proof(challenge)}
        self.api(
            "POST", path + "/authorization-challenge", json={"expected_revision": 1}
        )
        self.assertEqual(
            self.api("POST", path + "/authorize", json=proof).status_code, 401
        )
        challenge = self.api(
            "POST", path + "/authorization-challenge", json={"expected_revision": 1}
        ).json()
        proof = {"expected_revision": 1, **self.proof(challenge)}
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_brightness_tasks SET percent=40 WHERE id=?",
                (task["task_id"],),
            )
        self.assertEqual(
            self.api("POST", path + "/authorize", json=proof).status_code, 409
        )

    def test_cancel_before_and_after_claim_never_claims_success(self):
        task = self.create().json()
        permit = self.authorize(task)
        self.assertEqual(
            self.api("POST", self.path(task) + "/cancel", json={}).json()["state"],
            "cancelled",
        )
        self.assertEqual(
            self.api(
                "POST", self.path(task) + "/claim", json=self.claim_body(permit)
            ).status_code,
            409,
        )
        task = self.create(key="another-brightness-request").json()
        self.api(
            "POST",
            self.path(task) + "/claim",
            json=self.claim_body(self.authorize(task)),
        )
        self.assertEqual(
            self.api("POST", self.path(task) + "/cancel", json={}).json()["state"],
            "outcome_unknown",
        )

    def test_lost_response_expiry_and_new_session_do_not_reexecute(self):
        task = self.create().json()
        self.api(
            "POST",
            self.path(task) + "/claim",
            json=self.claim_body(self.authorize(task)),
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_brightness_tasks SET claim_expires_at=0 WHERE id=?",
                (task["task_id"],),
            )
        self.assertEqual(
            self.api("GET", self.path(task)).json()["state"], "outcome_unknown"
        )
        self.assertEqual(self.create().json()["state"], "outcome_unknown")
        response = self.api(
            "POST", "/brightness/sessions", token=self.management, json={}
        )
        self.simulation = response.json()["access_token"]
        self.assertEqual(self.create().status_code, 409)
        self.assertEqual(self.api("GET", self.path(task)).status_code, 404)

    def test_bad_observation_and_receipt_tampering(self):
        task = self.create().json()
        claim = self.api(
            "POST",
            self.path(task) + "/claim",
            json=self.claim_body(self.authorize(task)),
        ).json()
        result = {
            "expected_revision": 3,
            "claim_id": claim["claim_id"],
            "outcome": "verified",
            "observed_index": 5001,
            "max_index": 10000,
        }
        self.assertEqual(
            self.api(
                "POST", self.path(task) + "/receipt-challenge", json=result
            ).status_code,
            409,
        )
        result["observed_index"] = 5000
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
        response = self.api(
            "POST",
            self.path(task) + "/receipt",
            json={**result, **self.proof(challenge)},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            self.api(
                "POST",
                self.path(task) + "/receipt",
                json={**result, **self.proof(challenge)},
            ).status_code,
            409,
        )

    def test_migration_repeat_and_private_payload_exclusion(self):
        from app.db.assistant_migrations import migrate_assistant_security

        with database.get_db_connection(write=True) as conn:
            migrate_assistant_security(conn)
            migrate_assistant_security(conn)
            self.assertEqual(
                conn.execute(
                    "SELECT MAX(version) AS version FROM assistant_schema_versions"
                ).fetchone()["version"],
                6,
            )
        response = self.create()
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn(self.simulation, response.text)
        self.assertEqual(
            set(response.json()),
            {"task_id", "mode", "action", "revision", "state", "result"},
        )

    def test_signature_forgery_and_expired_authorization_fail_closed(self):
        task = self.create().json()
        challenge = self.api(
            "POST",
            self.path(task) + "/authorization-challenge",
            json={"expected_revision": 1},
        ).json()
        proof = {"expected_revision": 1, **self.proof(challenge)}
        proof["signature"] = "A" * 96
        self.assertEqual(
            self.api("POST", self.path(task) + "/authorize", json=proof).status_code,
            401,
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_brightness_tasks SET challenge_expires_at=0 WHERE id=?",
                (task["task_id"],),
            )
        self.assertEqual(
            self.api(
                "POST",
                self.path(task) + "/authorize",
                json={"expected_revision": 1, **self.proof(challenge)},
            ).status_code,
            401,
        )

    def test_same_device_other_scope_cannot_read_or_claim_an_existing_task(self):
        task = self.create().json()
        body = self.claim_body(self.authorize(task))
        other_session = self.api(
            "POST", "/brightness/sessions", token=self.management, json={}
        ).json()["access_token"]
        self.assertEqual(
            self.api("GET", self.path(task), token=other_session).status_code, 404
        )
        self.assertEqual(
            self.api(
                "POST", self.path(task) + "/claim", token=other_session, json=body
            ).status_code,
            404,
        )

    def test_policy_change_after_confirmation_blocks_dispatch(self):
        from app.assistant import brightness

        task = self.create().json()
        body = self.claim_body(self.authorize(task))
        with patch.object(brightness, "POLICY_VERSION", 2):
            self.assertEqual(
                self.api("POST", self.path(task) + "/claim", json=body).status_code, 409
            )

    def test_cross_capability_tokens_never_authorize_another_control(self):
        volume = self.api(
            "POST", "/volume/sessions", token=self.management, json={}
        ).json()["access_token"]
        self.assertEqual(
            self.api(
                "POST",
                "/brightness/tasks",
                token=volume,
                json={
                    "idempotency_key": "cross-scope-brightness",
                    "action": {"capability_id": "brightness.set_app", "percent": 40},
                },
            ).status_code,
            401,
        )
        self.assertEqual(
            self.api(
                "POST",
                "/volume/tasks",
                token=self.simulation,
                json={
                    "idempotency_key": "cross-scope-volume",
                    "action": {"capability_id": "media_volume.set", "percent": 40},
                },
            ).status_code,
            401,
        )

    def test_window_receipts_cannot_substitute_audio_stream_units(self):
        task = self.create().json()
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
        self.assertEqual(
            self.api(
                "POST", self.path(task) + "/receipt-challenge", json=result
            ).status_code,
            422,
        )


class TursoAssistantBrightnessTests(AssistantBrightnessTests):
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


if __name__ == "__main__":
    unittest.main()
