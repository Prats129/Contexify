"""Synthetic, disposable SQL/HTTP fixtures; never loads configured providers."""

import asyncio
import json
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from unittest.mock import patch

import httpx
import test_assistant_security as bootstrap
from fastapi import HTTPException
from turso_http_fixture import TursoHTTPFixture

from app.assistant import service
from app.core.security import digest
from app.db import database
from app.db.turso_http import close_http_client
from app.main import app
from app.schemas.assistant import ClaimRequest


class AssistantCoreTests(bootstrap.AssistantSecurityFixture):
    def setUp(self):
        super().setUp()
        enabled = patch.object(
            bootstrap.fixture.settings,
            "ASSISTANT_SIMULATION_ENABLED",
            True,
            create=True,
        )
        enabled.start()
        self.addCleanup(enabled.stop)
        self.device = self.enroll()
        self.management = self.device_session(self.device)
        response = self.api(
            "POST", "/simulation/sessions", token=self.management, json={}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.simulation = response.json()["access_token"]

    def api(self, method, path, token=None, **kwargs):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://api.fixture.invalid",
            ) as client:
                return await client.request(
                    method,
                    "/api/v1/assistant" + path,
                    headers={
                        "Authorization": "Bearer "
                        + (token or getattr(self, "simulation", ""))
                    },
                    **kwargs,
                )

        return asyncio.run(send())

    def create(self, steps=None, key="synthetic-idempotency-key"):
        return self.api(
            "POST",
            "/simulation/tasks",
            json={
                "idempotency_key": key,
                "proposal": {
                    "steps": steps
                    or [
                        {"action": {"capability_id": "media_volume.set", "percent": 50}}
                    ]
                },
            },
        )

    def path(self, task, index=0):
        return (
            "/simulation/tasks/"
            + task["task_id"]
            + "/actions/"
            + task["actions"][index]["action_id"]
        )

    def authorize(self, task, index=0):
        path = self.path(task, index)
        response = self.api(
            "POST", path + "/authorization-challenge", json={"expected_revision": 1}
        )
        self.assertEqual(response.status_code, 200, response.text)
        challenge = response.json()
        response = self.api(
            "POST",
            path + "/authorize",
            json={"expected_revision": 1, **self.proof(challenge)},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def claim(self, task, permit, index=0):
        body = {
            "expected_revision": permit["action_revision"],
            "permit": permit["permit"],
            **self.proof(permit["claim_challenge"]),
        }
        response = self.api("POST", self.path(task, index) + "/claim", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json(), body

    def finish(self, task, claim, outcome="simulated", index=0):
        body = {
            "expected_revision": claim["action_revision"],
            "claim_id": claim["claim_id"],
            "outcome": outcome,
        }
        response = self.api(
            "POST", self.path(task, index) + "/receipt-challenge", json=body
        )
        self.assertEqual(response.status_code, 200, response.text)
        return self.api(
            "POST",
            self.path(task, index) + "/receipt",
            json={**body, **self.proof(response.json())},
        )

    def test_round_trip_idempotency_and_minimal_events(self):
        task = self.create().json()
        self.assertEqual(self.create().json(), task)
        self.assertEqual(
            self.create(
                [{"action": {"capability_id": "media_volume.set", "percent": 40}}]
            ).status_code,
            409,
        )
        permit = self.authorize(task)
        fields = json.loads(permit["claim_challenge"]["payload"])
        self.assertEqual(fields["arguments_digest"], digest(fields["arguments_json"]))
        self.assertEqual(fields["installation_id"], self.installation)
        claim, body = self.claim(task, permit)
        self.assertEqual(claim["execution"], "simulation_only")
        self.assertEqual(
            self.api("POST", self.path(task) + "/claim", json=body).status_code, 409
        )
        response = self.finish(task, claim)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["state"], "simulated")
        self.assertEqual(self.create().json()["state"], "simulated")
        events = self.api(
            "GET", "/simulation/tasks/" + task["task_id"] + "/events"
        ).json()
        self.assertTrue(events)
        for event in events:
            self.assertEqual(
                set(event), {"event_id", "action_id", "state", "created_at"}
            )
        with database.get_db_connection() as conn:
            self.assertIsNone(
                conn.execute(
                    "SELECT token_hash FROM assistant_permits WHERE token_hash=?",
                    (permit["permit"],),
                ).fetchone()
            )

    def test_tokens_do_not_cross_security_chat_or_simulation_scopes(self):
        for token in [self.token, self.other_token, self.management]:
            self.assertEqual(
                self.api("POST", "/simulation/tasks", token=token, json={}).status_code,
                401,
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
        cookie, csrf = self.web_session()
        authority = bootstrap.service.SecuritySession(
            self.alice.id, digest(cookie), None
        )
        with self.assertRaises(HTTPException) as error:
            service.create_session(authority)
        self.assertEqual(error.exception.status_code, 403)

    def test_device_parent_and_session_revocation(self):
        task = self.create().json()
        for table, assignment, parameter in [
            ("assistant_simulation_sessions", "expires_at=0", digest(self.simulation)),
            ("assistant_security_sessions", "expires_at=0", digest(self.management)),
        ]:
            with database.get_db_connection(write=True) as conn:
                old = self.database_row(
                    conn,
                    f"SELECT expires_at FROM {table} WHERE token_hash=?",
                    (parameter,),
                )[0]
                conn.execute(
                    f"UPDATE {table} SET {assignment} WHERE token_hash=?", (parameter,)
                )
            self.assertEqual(
                self.api("GET", "/simulation/tasks/" + task["task_id"]).status_code, 401
            )
            with database.get_db_connection(write=True) as conn:
                conn.execute(
                    f"UPDATE {table} SET expires_at=? WHERE token_hash=?",
                    (old, parameter),
                )
        self.assertEqual(
            self.request(
                "DELETE", "/devices/" + self.device, self.management
            ).status_code,
            204,
        )
        self.assertEqual(
            self.api("GET", "/simulation/tasks/" + task["task_id"]).status_code, 401
        )

    def test_same_user_second_device_cannot_read_task(self):
        task = self.create().json()
        import uuid

        self.installation = str(uuid.uuid4())
        # A new installation needs a distinct key, even for the same account.
        import base64

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        self.key = ec.generate_private_key(ec.SECP256R1())
        self.public_key = base64.b64encode(
            self.key.public_key().public_bytes(
                serialization.Encoding.X962,
                serialization.PublicFormat.UncompressedPoint,
            )
        ).decode()
        management = self.device_session(self.enroll())
        token = self.api(
            "POST", "/simulation/sessions", token=management, json={}
        ).json()["access_token"]
        self.assertEqual(
            self.api(
                "GET", "/simulation/tasks/" + task["task_id"], token=token
            ).status_code,
            404,
        )
        self.assertEqual(
            self.api(
                "POST",
                self.path(task) + "/authorization-challenge",
                token=token,
                json={"expected_revision": 1},
            ).status_code,
            404,
        )

    def test_exact_arguments_signatures_challenge_replacement_and_revision(self):
        task = self.create().json()
        path = self.path(task)
        first = self.api(
            "POST", path + "/authorization-challenge", json={"expected_revision": 1}
        ).json()
        second = self.api(
            "POST", path + "/authorization-challenge", json={"expected_revision": 1}
        ).json()
        self.assertEqual(
            self.api(
                "POST",
                path + "/authorize",
                json={"expected_revision": 1, **self.proof(first)},
            ).status_code,
            401,
        )
        body = {
            "expected_revision": 1,
            **self.proof(second, payload=second["payload"].replace("50", "40")),
        }
        self.assertEqual(
            self.api("POST", path + "/authorize", json=body).status_code, 401
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_actions SET arguments_digest='changed' WHERE id=?",
                (task["actions"][0]["action_id"],),
            )
        self.assertEqual(
            self.api(
                "POST",
                path + "/authorize",
                json={"expected_revision": 1, **self.proof(second)},
            ).status_code,
            409,
        )

    def test_expired_authorization_and_claim_have_honest_terminal_states(self):
        task = self.create().json()
        self.authorize(task)
        with database.get_db_connection(write=True) as conn:
            conn.execute("UPDATE assistant_permits SET expires_at=0")
        self.assertEqual(
            self.api("GET", "/simulation/tasks/" + task["task_id"]).json()["state"],
            "expired",
        )
        task = self.create(key="another-synthetic-key").json()
        claim, _ = self.claim(task, self.authorize(task))
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_actions SET claim_expires_at=0 WHERE task_id=?",
                (task["task_id"],),
            )
        self.assertEqual(
            self.api("GET", "/simulation/tasks/" + task["task_id"]).json()["state"],
            "outcome_unknown",
        )
        self.assertEqual(
            self.api(
                "POST",
                self.path(task) + "/receipt-challenge",
                json={
                    "expected_revision": 3,
                    "claim_id": claim["claim_id"],
                    "outcome": "simulated",
                },
            ).status_code,
            409,
        )

    def test_cancel_after_claim_is_unknown_and_failure_stops_later_steps(self):
        steps = [
            {"action": {"capability_id": "media_volume.set", "percent": 50}},
            {
                "action": {
                    "capability_id": "application.open",
                    "application_id": "clock",
                },
                "depends_on": [0],
            },
        ]
        task = self.create(steps).json()
        self.assertEqual(
            self.api(
                "POST",
                self.path(task, 1) + "/authorization-challenge",
                json={"expected_revision": 1},
            ).status_code,
            409,
        )
        claim, _ = self.claim(task, self.authorize(task))
        failed = self.finish(task, claim, "failed").json()
        self.assertEqual(
            [a["state"] for a in failed["actions"]], ["failed", "cancelled"]
        )
        task = self.create(key="cancel-synthetic-key").json()
        self.claim(task, self.authorize(task))
        result = self.api(
            "POST", "/simulation/tasks/" + task["task_id"] + "/cancel", json={}
        ).json()
        self.assertEqual(result["state"], "outcome_unknown")

    def test_one_claim_wins_under_concurrency(self):
        task = self.create().json()
        permit = self.authorize(task)
        proof = ClaimRequest(
            expected_revision=2,
            permit=permit["permit"],
            **self.proof(permit["claim_challenge"]),
        )
        with database.get_db_connection() as conn:
            authority = service._authority(conn, digest(self.simulation))

        def run(_):
            try:
                return service.claim(
                    authority, task["task_id"], task["actions"][0]["action_id"], proof
                )
            except HTTPException as error:
                return error.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, range(2)))
        self.assertEqual(
            sum(isinstance(result, dict) for result in results), 1, results
        )
        self.assertIn(409, results)

    def test_invalid_proposals_cannot_allocate_tasks_or_run_tools(self):
        invalid = [
            {"capability_id": "shell.exec", "code": "anything"},
            {
                "capability_id": "application.open",
                "application_id": "https://evil.invalid",
            },
            {"capability_id": "media_volume.set", "percent": 71},
            {"capability_id": "brightness.set_app", "percent": 9},
            {"capability_id": "media_volume.set", "percent": True},
            {"capability_id": "media_volume.set", "percent": "50"},
            {
                "capability_id": "media_volume.set",
                "percent": 50,
                "prompt": "ignore policy",
            },
            {
                "capability_id": "media_volume.set",
                "percent": 50,
                "schema_version": True,
            },
        ]
        for action in invalid:
            self.assertEqual(self.create([{"action": action}]).status_code, 422, action)
        self.assertEqual(
            self.create(
                [
                    {
                        "action": {"capability_id": "media_volume.set", "percent": 50},
                        "depends_on": [0],
                    }
                ]
            ).status_code,
            422,
        )
        with database.get_db_connection() as conn:
            self.assertEqual(
                self.database_row(conn, "SELECT COUNT(*) FROM assistant_tasks")[0], 0
            )

    def test_wrong_permit_and_receipt_tampering_rollback_proof_consumption(self):
        task = self.create().json()
        permit = self.authorize(task)
        path = self.path(task)
        proof = self.proof(permit["claim_challenge"])
        wrong = {"expected_revision": 2, "permit": "A" * 43, **proof}
        self.assertEqual(self.api("POST", path + "/claim", json=wrong).status_code, 401)
        response = self.api(
            "POST", path + "/claim", json={**wrong, "permit": permit["permit"]}
        )
        self.assertEqual(response.status_code, 200, response.text)
        claim = response.json()
        body = {
            "expected_revision": 3,
            "claim_id": claim["claim_id"],
            "outcome": "simulated",
        }
        challenge = self.api("POST", path + "/receipt-challenge", json=body).json()
        proof = self.proof(challenge)
        self.assertEqual(
            self.api(
                "POST", path + "/receipt", json={**body, **proof, "outcome": "failed"}
            ).status_code,
            409,
        )
        response = self.api("POST", path + "/receipt", json={**body, **proof})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["state"], "simulated")
        self.assertEqual(
            self.api("POST", path + "/receipt", json={**body, **proof}).status_code, 409
        )

    def test_authority_rechecked_inside_transaction_and_policy_invalidates_old_plan(
        self,
    ):
        task = self.create().json()
        with database.get_db_connection() as conn:
            authority = service._authority(conn, digest(self.simulation))
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_tasks SET policy_version=2 WHERE id=?",
                (task["task_id"],),
            )
        self.assertEqual(
            self.api(
                "POST",
                self.path(task) + "/authorization-challenge",
                json={"expected_revision": 1},
            ).status_code,
            409,
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE users SET password_hash='changed' WHERE id=?", (self.alice.id,)
            )
        with self.assertRaises(HTTPException) as error:
            service.get_task(authority, task["task_id"])
        self.assertEqual(error.exception.status_code, 401)

    def test_changed_device_binding_cannot_reuse_an_earlier_authority(self):
        task = self.create().json()
        with database.get_db_connection() as conn:
            authority = service._authority(conn, digest(self.simulation))
        for field, value in [
            ("platform", "ios"),
            ("installation_id", "different-installation"),
            ("public_key", "different-key"),
        ]:
            with self.subTest(field=field), self.assertRaises(HTTPException) as error:
                service.get_task(replace(authority, **{field: value}), task["task_id"])
            self.assertEqual(error.exception.status_code, 401)

    def test_concurrent_idempotent_create_allocates_once(self):
        from app.schemas.assistant import CreateTaskRequest

        payload = CreateTaskRequest.model_validate(
            {
                "idempotency_key": "concurrent-synthetic-key",
                "proposal": {
                    "steps": [
                        {
                            "action": {
                                "capability_id": "application.open",
                                "application_id": "clock",
                            }
                        }
                    ]
                },
            }
        )
        with database.get_db_connection() as conn:
            authority = service._authority(conn, digest(self.simulation))
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(lambda _: service.create_task(authority, payload), range(2))
            )
        self.assertEqual(results[0].task_id, results[1].task_id)
        with database.get_db_connection() as conn:
            self.assertEqual(
                self.database_row(conn, "SELECT COUNT(*) FROM assistant_tasks")[0], 1
            )

    def test_expired_challenge_and_different_account_cannot_confirm(self):
        task = self.create().json()
        path = self.path(task)
        challenge = self.api(
            "POST", path + "/authorization-challenge", json={"expected_revision": 1}
        ).json()
        with database.get_db_connection(write=True) as conn:
            conn.execute("UPDATE assistant_action_challenges SET expires_at=0")
        body = {"expected_revision": 1, **self.proof(challenge)}
        self.assertEqual(
            self.api("POST", path + "/authorize", json=body).status_code, 401
        )
        # Issue a second registered user's simulation scope through a distinct device.
        import uuid

        from app.services.assistant_security import SecuritySession

        with database.get_db_connection(write=True) as conn:
            other_device = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO assistant_devices VALUES(?,?,?,?,?,?,?,NULL)",
                (
                    other_device,
                    self.bob.id,
                    str(uuid.uuid4()),
                    "synthetic-other-key",
                    "android",
                    bootstrap.fixture.settings.ASSISTANT_API_ORIGIN,
                    1,
                ),
            )
            # Reuse the real fixture-issued credential's token hash, never a user_id assertion.
            conn.execute(
                "INSERT INTO assistant_security_sessions "
                "(token_hash,parent_token_hash,user_id,device_id,kind,origin,api_origin,expires_at) VALUES(?,?,?,?,'device',?,?,?)",
                (
                    digest("other-management"),
                    digest(self.other_token),
                    self.bob.id,
                    other_device,
                    bootstrap.fixture.settings.ASSISTANT_API_ORIGIN,
                    bootstrap.fixture.settings.ASSISTANT_API_ORIGIN,
                    9999999999,
                ),
            )
        other = service.create_session(
            SecuritySession(self.bob.id, digest("other-management"), other_device)
        )["access_token"]
        self.assertEqual(
            self.api(
                "GET", "/simulation/tasks/" + task["task_id"], token=other
            ).status_code,
            404,
        )
        self.assertEqual(
            self.api("POST", path + "/authorize", token=other, json=body).status_code,
            404,
        )

    def test_flags_and_transport_fail_closed(self):
        with patch.object(
            bootstrap.fixture.settings, "ASSISTANT_SIMULATION_ENABLED", False
        ):
            self.assertEqual(self.create().status_code, 404)
        with patch.object(
            bootstrap.fixture.settings,
            "ASSISTANT_API_ORIGIN",
            "https://different.fixture.invalid",
        ):
            self.assertEqual(self.create().status_code, 403)
        response = self.api("GET", "/capabilities", token=self.management)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(
            all(item["execution"] == "simulation_only" for item in response.json())
        )


class TursoAssistantCoreTests(AssistantCoreTests):
    """The same protocol assertions through the loopback HTTP SQL adapter."""

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
        enabled = patch.object(
            bootstrap.fixture.settings,
            "ASSISTANT_SIMULATION_ENABLED",
            True,
            create=True,
        )
        enabled.start()
        self.addCleanup(enabled.stop)
        database.init_db()
        self.device = self.enroll()
        self.management = self.device_session(self.device)
        response = self.api(
            "POST", "/simulation/sessions", token=self.management, json={}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.simulation = response.json()["access_token"]


class AssistantMigrationTests(unittest.TestCase):
    def test_v1_upgrade_rollback_repeat_and_restore_preserve_existing_devices(self):
        from app.db.assistant_migrations import (
            _migrate_security_v1,
            migrate_assistant_security,
        )

        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("CREATE TABLE users(id TEXT PRIMARY KEY)")
        conn.execute(
            "CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT)"
        )
        _migrate_security_v1(conn)
        conn.execute("INSERT INTO users VALUES('synthetic-user')")
        conn.execute(
            "INSERT INTO assistant_devices VALUES('synthetic-device','synthetic-user',"
            "'synthetic-installation','synthetic-key','android','https://api.fixture.invalid',1,NULL)"
        )
        conn.commit()
        conn.execute("BEGIN IMMEDIATE")
        migrate_assistant_security(conn)
        conn.rollback()
        self.assertEqual(
            conn.execute("SELECT COUNT(*) FROM assistant_schema_versions").fetchone()[
                0
            ],
            1,
        )
        self.assertIsNone(
            conn.execute(
                "SELECT name FROM sqlite_master WHERE name='assistant_tasks'"
            ).fetchone()
        )
        migrate_assistant_security(conn)
        migrate_assistant_security(conn)
        conn.commit()
        self.assertEqual(
            conn.execute("SELECT COUNT(*) FROM assistant_schema_versions").fetchone()[
                0
            ],
            7,
        )
        self.assertEqual(
            conn.execute("SELECT public_key FROM assistant_devices").fetchone()[0],
            "synthetic-key",
        )
        self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])
        restored = sqlite3.connect(":memory:")
        self.addCleanup(restored.close)
        conn.backup(restored)
        self.assertEqual(
            restored.execute("SELECT public_key FROM assistant_devices").fetchone()[0],
            "synthetic-key",
        )
        self.assertIsNotNone(
            restored.execute(
                "SELECT name FROM sqlite_master WHERE name='assistant_tasks'"
            ).fetchone()
        )


if __name__ == "__main__":
    unittest.main()
