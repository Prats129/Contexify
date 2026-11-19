"""Phase 1A regressions with fixture settings, disposable SQL and no providers.

Run: backend/venv/Scripts/python.exe -B backend/tests/test_assistant_security.py
The imported existing harness installs config/provider stubs before app imports.
"""

import asyncio
import base64
import sqlite3
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest.mock import patch

import httpx
import test_auth_security as fixture
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from turso_http_fixture import TursoHTTPFixture

from app.core import security
from app.db import database
from app.db.assistant_migrations import migrate_assistant_security
from app.db.turso_http import close_http_client
from app.main import app
from app.schemas.assistant_security import EnrollmentRequest, ProofRequest
from app.services import assistant_security as service


class AssistantSecurityFixture(unittest.TestCase):
    def setUp(self):
        self.account_fixture = fixture.SecurityTests()
        # Keep the account fixture's disposable database unique per assistant test.
        self.account_fixture._testMethodName = self.id()
        self.account_fixture.setUp()
        self.addCleanup(self.account_fixture.doCleanups)
        self.alice = self.account_fixture.alice
        self.bob = self.account_fixture.bob
        self.token = self.account_fixture.token
        self.other_token = self.account_fixture.other_token
        self.principal = self.account_fixture.principal
        for key, value in {
            "ASSISTANT_SECURITY_ENABLED": True,
            "ASSISTANT_API_ORIGIN": "https://api.fixture.invalid",
            "ASSISTANT_WEB_ORIGINS": [
                "https://web.fixture.invalid",
                "https://other.fixture.invalid",
            ],
            "ASSISTANT_SESSION_TTL_SECONDS": 900,
            "ASSISTANT_FRESH_AUTH_SECONDS": 300,
        }.items():
            fixture.settings.__dict__[key] = value
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.installation = str(uuid.uuid4())
        self.public_key = base64.b64encode(
            self.key.public_key().public_bytes(
                serialization.Encoding.X962,
                serialization.PublicFormat.UncompressedPoint,
            )
        ).decode()

    def database_row(
        self,
        connection: sqlite3.Connection | database.TursoConnection,
        query: str,
        parameters: tuple = (),
    ):
        row = connection.execute(query, parameters).fetchone()
        if row is None:
            self.fail("Expected a row in the disposable test database.")
        return row

    def request(
        self, method, path, token=None, origin=None, csrf=None, cookie=None, **kwargs
    ):
        headers = kwargs.pop("headers", {})
        if token:
            headers["Authorization"] = "Bearer " + token
        if origin:
            headers["Origin"] = origin
            headers["X-Contexify-Assistant"] = "1"
        if csrf:
            headers["X-CSRF-Token"] = csrf
        if cookie:
            headers["Cookie"] = service.COOKIE_NAME + "=" + cookie

        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://api.fixture.invalid",
            ) as client:
                return await client.request(
                    method,
                    "/api/v1/assistant/security" + path,
                    headers=headers,
                    **kwargs,
                )

        return asyncio.run(send())

    def challenge(self, token=None):
        response = self.request(
            "POST",
            "/enrollment/challenge",
            token or self.token,
            json={
                "installation_id": self.installation,
                "public_key": self.public_key,
                "platform": "android",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def proof(self, challenge, key=None, payload=None):
        signed = (key or self.key).sign(
            (payload or challenge["payload"]).encode(), ec.ECDSA(hashes.SHA256())
        )
        return {
            "challenge_id": challenge["challenge_id"],
            "signature": base64.b64encode(signed).decode(),
        }

    def enroll(self):
        response = self.request(
            "POST", "/enrollment", self.token, json=self.proof(self.challenge())
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["device_id"]

    def device_session(self, device_id):
        response = self.request(
            "POST",
            "/device-session/challenge",
            self.token,
            json={"device_id": device_id},
        )
        self.assertEqual(response.status_code, 200, response.text)
        response = self.request(
            "POST", "/device-session", self.token, json=self.proof(response.json())
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["scope"], "security:manage")
        return response.json()["access_token"]

    def web_session(self):
        response = self.request(
            "POST",
            "/web-session",
            self.token,
            origin="https://web.fixture.invalid",
            json={},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("access_token", response.json())
        header = response.headers["set-cookie"]
        for attribute in ["HttpOnly", "Secure", "SameSite=strict", "Path=/"]:
            self.assertIn(attribute, header)
        self.assertNotIn("Domain=", header)
        return response.cookies[service.COOKIE_NAME], response.json()["csrf_token"]


class AssistantSecurityTests(AssistantSecurityFixture):
    def test_enrollment_requires_real_fresh_registered_session(self):
        self.assertEqual(
            self.request("POST", "/enrollment/challenge", json={}).status_code, 401
        )
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE auth_sessions SET authenticated_at=0 WHERE token_hash=?",
                (self.principal.token_hash,),
            )
        data = {
            "installation_id": self.installation,
            "public_key": self.public_key,
            "platform": "android",
        }
        self.assertEqual(
            self.request(
                "POST", "/enrollment/challenge", self.token, json=data
            ).status_code,
            401,
        )
        guest = security.create_guest()["access_token"]
        self.assertEqual(
            self.request("POST", "/enrollment/challenge", guest, json=data).status_code,
            403,
        )

    def test_wrong_key_modified_payload_and_cross_user_session_rejected(self):
        challenge = self.challenge()
        different = ec.generate_private_key(ec.SECP256R1())
        for token, proof in [
            (self.token, self.proof(challenge, different)),
            (self.token, self.proof(challenge, payload=challenge["payload"] + " ")),
            (self.other_token, self.proof(challenge)),
            (
                security.issue_credentials(self.alice.id)["access_token"],
                self.proof(challenge),
            ),
        ]:
            self.assertEqual(
                self.request("POST", "/enrollment", token, json=proof).status_code, 401
            )
        self.assertEqual(
            self.request(
                "POST", "/enrollment", self.token, json=self.proof(challenge)
            ).status_code,
            200,
        )
        self.assertEqual(
            self.request(
                "POST", "/enrollment", self.token, json=self.proof(challenge)
            ).status_code,
            401,
        )

    def test_expiry_origin_change_and_logout_invalidate_pending_proof(self):
        challenge = self.challenge()
        with patch.object(service.time, "time", return_value=time.time() + 61):
            self.assertEqual(
                self.request(
                    "POST", "/enrollment", self.token, json=self.proof(challenge)
                ).status_code,
                401,
            )
        with patch.object(
            fixture.settings, "ASSISTANT_API_ORIGIN", "https://changed.fixture.invalid"
        ):
            self.assertEqual(
                self.request(
                    "POST", "/enrollment", self.token, json=self.proof(challenge)
                ).status_code,
                403,
            )
        with database.get_db_connection() as conn:
            conn.execute(
                "DELETE FROM auth_sessions WHERE token_hash=?",
                (self.principal.token_hash,),
            )
        self.assertEqual(
            self.request(
                "POST", "/enrollment", self.token, json=self.proof(challenge)
            ).status_code,
            401,
        )

    def test_atomic_proof_has_one_winner(self):
        proof = ProofRequest(**self.proof(self.challenge()))

        def finish(_):
            try:
                return service.finish_enrollment(self.principal, proof)["device_id"]
            except HTTPException as error:
                return error.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(finish, range(2)))
        self.assertEqual(sum(isinstance(result, str) for result in results), 1, results)
        self.assertIn(401, results)

    def test_session_scope_cross_user_isolation_and_revocation(self):
        device = self.enroll()
        token = self.device_session(device)
        self.assertEqual(self.request("GET", "/session", self.token).status_code, 401)
        self.assertEqual(self.request("GET", "/session", token).status_code, 200)
        denied = self.request(
            "POST",
            "/device-session/challenge",
            self.other_token,
            json={"device_id": device},
        )
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(
            self.request("DELETE", "/devices/" + str(uuid.uuid4()), token).status_code,
            404,
        )
        self.assertEqual(
            self.request("DELETE", "/devices/" + device, token).status_code, 204
        )
        self.assertEqual(self.request("GET", "/session", token).status_code, 401)
        self.assertEqual(
            self.request(
                "POST",
                "/device-session/challenge",
                self.token,
                json={"device_id": device},
            ).status_code,
            404,
        )
        # Management-only credentials cannot authenticate existing chat APIs.
        response = self.account_fixture.request("GET", "/user/me", token)
        self.assertEqual(response.status_code, 401)

    def test_parent_logout_password_change_and_session_expiry(self):
        token = self.device_session(self.enroll())
        with patch.object(service.time, "time", return_value=time.time() + 901):
            self.assertEqual(self.request("GET", "/session", token).status_code, 401)
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE users SET password_hash='changed' WHERE id=?", (self.alice.id,)
            )
        self.assertEqual(self.request("GET", "/session", token).status_code, 401)

    def test_web_cookie_csrf_origin_and_token_transport_are_independent(self):
        cookie, csrf = self.web_session()
        for origin, supplied_csrf, status in [
            (None, csrf, 403),
            ("https://evil.invalid", csrf, 403),
            ("https://web.fixture.invalid", None, 403),
            ("https://web.fixture.invalid", "wrong", 403),
            ("https://other.fixture.invalid", csrf, 403),
            ("https://web.fixture.invalid", csrf, 200),
        ]:
            self.assertEqual(
                self.request(
                    "GET", "/session", cookie=cookie, origin=origin, csrf=supplied_csrf
                ).status_code,
                status,
            )
        self.assertEqual(self.request("GET", "/session", cookie).status_code, 401)
        result = self.request(
            "DELETE",
            "/session",
            cookie=cookie,
            csrf=csrf,
            origin="https://web.fixture.invalid",
        )
        self.assertEqual(result.status_code, 204)
        self.assertEqual(
            self.request(
                "GET",
                "/session",
                cookie=cookie,
                csrf=csrf,
                origin="https://web.fixture.invalid",
            ).status_code,
            401,
        )

    def test_web_bootstrap_cannot_use_unknown_origins_or_stale_login(self):
        for origin in [
            None,
            "null",
            "https://web.fixture.invalid.evil",
            "https://web.fixture.invalid:444",
        ]:
            self.assertEqual(
                self.request(
                    "POST", "/web-session", self.token, origin=origin, json={}
                ).status_code,
                403,
            )
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE auth_sessions SET authenticated_at=? WHERE token_hash=?",
                (time.time() - 301, self.principal.token_hash),
            )
        self.assertEqual(
            self.request(
                "POST",
                "/web-session",
                self.token,
                origin="https://web.fixture.invalid",
                json={},
            ).status_code,
            401,
        )

    def test_same_origin_browser_get_without_origin_requires_fetch_metadata_and_csrf(
        self,
    ):
        with patch.object(
            fixture.settings, "ASSISTANT_WEB_ORIGINS", ["https://api.fixture.invalid"]
        ):
            response = self.request(
                "POST",
                "/web-session",
                self.token,
                origin="https://api.fixture.invalid",
                json={},
            )
            self.assertEqual(response.status_code, 200)
            cookie, csrf = (
                response.cookies[service.COOKIE_NAME],
                response.json()["csrf_token"],
            )
            for provenance, expected in [
                ("same-origin", 200),
                ("same-site", 403),
                ("cross-site", 403),
                ("none", 403),
            ]:
                result = self.request(
                    "GET",
                    "/session",
                    cookie=cookie,
                    csrf=csrf,
                    headers={
                        "Sec-Fetch-Site": provenance,
                        "X-Contexify-Assistant": "1",
                    },
                )
                self.assertEqual(result.status_code, expected)
            result = self.request(
                "DELETE",
                "/session",
                cookie=cookie,
                csrf=csrf,
                headers={"Sec-Fetch-Site": "same-origin", "X-Contexify-Assistant": "1"},
            )
            self.assertEqual(result.status_code, 403)

    def test_no_private_payload_reflection_or_chat_side_effects(self):
        secret = "private message that must not be persisted or echoed"
        response = self.request(
            "POST", "/enrollment/challenge", self.token, json={"command": secret}
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertIn("default-src 'none'", response.headers["content-security-policy"])
        response = self.request(
            "POST",
            "/web-session",
            self.token,
            origin="https://web.fixture.invalid",
            json={"command": secret},
        )
        self.assertEqual(response.status_code, 422)
        with database.get_db_connection() as conn:
            self.assertEqual(
                self.database_row(conn, "SELECT COUNT(*) FROM messages")[0], 0
            )
            self.assertEqual(
                self.database_row(conn, "SELECT COUNT(*) FROM assistant_devices")[0], 0
            )

    def test_size_compression_query_and_transport_guards(self):
        self.assertEqual(
            self.request(
                "POST", "/enrollment", self.token, json={"content": "x" * 5000}
            ).status_code,
            413,
        )
        self.assertEqual(
            self.request(
                "POST",
                "/enrollment",
                self.token,
                content=b"{}",
                headers={
                    "Content-Encoding": "gzip",
                    "Content-Type": "application/json",
                },
            ).status_code,
            415,
        )
        self.assertEqual(self.request("GET", "/devices?token=private").status_code, 400)
        self.assertEqual(
            self.request("POST", "/enrollment", self.token, content=b"{}").status_code,
            415,
        )
        with patch.object(fixture.settings, "ASSISTANT_SECURITY_ENABLED", False):
            self.assertEqual(self.request("GET", "/devices").status_code, 404)
        response = self.account_fixture.request(
            "POST",
            "/assistant/security/enrollment/challenge",
            self.token,
            json={},
        )
        self.assertEqual(response.status_code, 403)
        response = self.request(
            "POST",
            "/web-session",
            self.token,
            origin="https://web.fixture.invalid",
            json={},
            headers={"Host": "unapproved.fixture.invalid"},
        )
        self.assertEqual(response.status_code, 403)

    def test_public_key_and_quota_validation(self):
        with self.assertRaises(HTTPException):
            service.begin_enrollment(
                self.principal,
                EnrollmentRequest(
                    installation_id=self.installation,
                    public_key="A" * 88,
                    platform="android",
                ),
            )
        for _ in range(8):
            self.challenge()
        response = self.request(
            "POST",
            "/enrollment/challenge",
            self.token,
            json={
                "installation_id": self.installation,
                "public_key": self.public_key,
                "platform": "android",
            },
        )
        self.assertEqual(response.status_code, 429)

    def test_cleanup_work_is_bounded_and_expired_rows_do_not_consume_user_quotas(self):
        with database.get_db_connection(write=True) as conn:
            for number in range(150):
                conn.execute(
                    "INSERT INTO assistant_security_sessions "
                    "(token_hash,parent_token_hash,user_id,kind,origin,api_origin,expires_at) "
                    "VALUES(?,?,?,'web',?,?,0)",
                    (
                        f"expired-{number}",
                        self.principal.token_hash,
                        self.alice.id,
                        fixture.settings.ASSISTANT_WEB_ORIGINS[0],
                        fixture.settings.ASSISTANT_API_ORIGIN,
                    ),
                )
        self.web_session()
        with database.get_db_connection() as conn:
            self.assertEqual(
                self.database_row(
                    conn,
                    "SELECT COUNT(*) FROM assistant_security_sessions WHERE expires_at=0",
                )[0],
                50,
            )
        with database.get_db_connection(write=True) as conn:
            for number in range(150):
                conn.execute(
                    "INSERT INTO assistant_challenges "
                    "(id,user_id,token_hash,purpose,payload,public_key,installation_id,platform,expires_at) "
                    "VALUES(?,?,?,'enroll','expired',?,?,'android',0)",
                    (
                        f"expired-{number}",
                        self.alice.id,
                        self.principal.token_hash,
                        self.public_key,
                        self.installation,
                    ),
                )
        self.challenge()
        with database.get_db_connection() as conn:
            self.assertEqual(
                self.database_row(
                    conn, "SELECT COUNT(*) FROM assistant_challenges WHERE expires_at=0"
                )[0],
                50,
            )

    def test_database_restore_does_not_reactivate_revoked_device(self):
        device = self.enroll()
        token = self.device_session(device)
        self.assertEqual(
            self.request("DELETE", "/devices/" + device, token).status_code, 204
        )
        restored_path = fixture.root / (self._testMethodName + "-restored.db")
        with (
            closing(sqlite3.connect(database.DB_FILE)) as source,
            closing(sqlite3.connect(restored_path)) as target,
        ):
            source.backup(target)
        with patch.object(database, "DB_FILE", restored_path):
            database.init_db()
            self.assertEqual(self.request("GET", "/session", token).status_code, 401)
            self.assertEqual(
                self.request(
                    "POST",
                    "/device-session/challenge",
                    self.token,
                    json={"device_id": device},
                ).status_code,
                404,
            )

    def test_bad_signature_cannot_publish_a_partial_device(self):
        challenge = self.challenge()
        proof = self.proof(challenge, ec.generate_private_key(ec.SECP256R1()))
        self.assertEqual(
            self.request("POST", "/enrollment", self.token, json=proof).status_code, 401
        )
        with database.get_db_connection() as conn:
            self.assertEqual(
                self.database_row(conn, "SELECT COUNT(*) FROM assistant_devices")[0], 0
            )
            self.assertIsNone(
                self.database_row(
                    conn,
                    "SELECT consumed_at FROM assistant_challenges WHERE id=?",
                    (challenge["challenge_id"],),
                )[0]
            )

    def test_additive_migration_rollback_repeat_and_restore(self):
        memory = sqlite3.connect(":memory:")
        self.addCleanup(memory.close)
        memory.row_factory = sqlite3.Row
        memory.execute("CREATE TABLE users(id TEXT PRIMARY KEY)")
        memory.execute(
            "CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,credential_hash TEXT,expires_at REAL)"
        )
        memory.execute(
            "INSERT INTO auth_sessions VALUES('legacy','u','hash',9999999999)"
        )
        memory.commit()
        memory.execute("BEGIN IMMEDIATE")
        migrate_assistant_security(memory)
        memory.rollback()
        self.assertEqual(
            len(memory.execute("PRAGMA table_info(auth_sessions)").fetchall()), 4
        )
        migrate_assistant_security(memory)
        migrate_assistant_security(memory)
        memory.commit()
        self.assertEqual(
            memory.execute("SELECT authenticated_at FROM auth_sessions").fetchone()[0],
            0,
        )
        self.assertEqual(
            memory.execute("SELECT COUNT(*) FROM assistant_schema_versions").fetchone()[
                0
            ],
            8,
        )
        restored = sqlite3.connect(":memory:")
        self.addCleanup(restored.close)
        memory.backup(restored)
        self.assertEqual(
            restored.execute("SELECT authenticated_at FROM auth_sessions").fetchone()[
                0
            ],
            0,
        )

    def test_turso_adapter_enrollment_claim_commit_and_rollback(self):
        path = database.DB_FILE
        server = TursoHTTPFixture(lambda: path)
        self.addCleanup(server.close)
        self.addCleanup(close_http_client)
        with (
            patch.object(fixture.settings, "DATABASE_TYPE", "turso"),
            patch.object(fixture.settings, "TURSO_DATABASE_URL", server.url),
        ):
            database.init_db()
            database.init_db()
            challenge = self.challenge()
            proof = self.proof(challenge)
            self.assertEqual(
                self.request("POST", "/enrollment", self.token, json=proof).status_code,
                200,
            )
            self.assertEqual(
                self.request("POST", "/enrollment", self.token, json=proof).status_code,
                401,
            )


if __name__ == "__main__":
    unittest.main()
