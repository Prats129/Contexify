"""Real HTTP driver checks using loopback SQL; no application configuration."""

import importlib
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import httpx
from turso_http_fixture import TursoHTTPFixture

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
turso_http = importlib.import_module("app.db.turso_http")


class TursoHTTPTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="contexify-http-")
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "fixture.db"
        self.server = TursoHTTPFixture(lambda: self.path)
        self.addCleanup(self.server.close)
        self.addCleanup(turso_http.close_http_client)
        self.connection = turso_http.connect(self.server.url, "fixture-token")
        self.addCleanup(self.connection.close)

    def begin(self):
        self.connection.execute("BEGIN")
        self.connection.execute(
            "CREATE TABLE fixture(id INTEGER PRIMARY KEY, value, other)"
        )

    def test_commit_baton_rotation_parameters_and_row_compatibility(self):
        self.begin()
        self.connection.execute(
            "INSERT INTO fixture VALUES(?,?,?)", (2**60, "fixture \u2713", b"\x00\xff")
        )
        self.connection.execute(
            "INSERT INTO fixture VALUES(:id,:value,:other)",
            {"id": 2, "value": None, "other": 1.25},
        )
        self.connection.commit()
        rows = self.connection.execute(
            "SELECT * FROM fixture ORDER BY id DESC"
        ).fetchall()
        self.assertEqual(tuple(rows[0]), (2**60, "fixture \u2713", b"\x00\xff"))
        self.assertEqual(
            dict(rows[0]),
            {"id": 2**60, "value": "fixture \u2713", "other": b"\x00\xff"},
        )
        self.assertEqual(tuple(rows[1]), (2, None, 1.25))
        batons = [body["baton"] for _, body, _ in self.server.requests if body["baton"]]
        self.assertEqual(len(batons), len(set(batons)))
        self.assertTrue(
            all(
                header == "Bearer fixture-token"
                for _, _, header in self.server.requests
            )
        )
        self.assertTrue(
            all(path.startswith("/v3/") for path, _, _ in self.server.requests)
        )

    def test_rollback_preserves_schema_and_rows(self):
        self.begin()
        self.connection.execute("INSERT INTO fixture VALUES(1,'original',NULL)")
        self.connection.commit()
        self.connection.execute("BEGIN")
        self.connection.execute("DROP TABLE fixture")
        self.connection.rollback()
        self.assertEqual(
            self.connection.execute("SELECT value FROM fixture").fetchone()[0],
            "original",
        )

    def test_close_rolls_back_uncommitted_changes(self):
        self.begin()
        self.connection.close()
        with closing(sqlite3.connect(self.path)) as observer:
            self.assertEqual(
                observer.execute(
                    "SELECT count(*) FROM sqlite_master WHERE name='fixture'"
                ).fetchone()[0],
                0,
            )

    def test_constraint_error_preserves_code_and_explicit_rollback(self):
        self.begin()
        self.connection.execute("INSERT INTO fixture VALUES(1,'first',NULL)")
        with self.assertRaises(turso_http.TursoDatabaseError) as caught:
            self.connection.execute("INSERT INTO fixture VALUES(1,'private-data',NULL)")
        code = caught.exception.code
        assert code is not None
        self.assertTrue(code.startswith("SQLITE_CONSTRAINT"))
        self.assertNotIn("private-data", str(caught.exception))
        self.assertTrue(self.connection.in_transaction)
        self.connection.rollback()

    def test_lock_error_is_machine_readable_and_rejected_begin_can_be_retried(self):
        self.connection.execute("BEGIN IMMEDIATE")
        second = turso_http.connect(self.server.url, "fixture-token")
        self.addCleanup(second.close)
        with self.assertRaises(turso_http.TursoDatabaseError) as caught:
            second.execute("BEGIN IMMEDIATE")
        self.assertEqual(caught.exception.code, "SQLITE_BUSY")
        self.assertFalse(second.in_transaction)
        self.connection.rollback()
        second.execute("BEGIN IMMEDIATE")
        self.assertTrue(second.in_transaction)
        second.rollback()

    def test_http_error_is_redacted_and_never_retried(self):
        self.server.response_override = lambda *_: (
            401,
            b"private-token private-provider-body",
        )
        with self.assertRaises(turso_http.TursoDatabaseError) as caught:
            self.connection.execute("SELECT 1")
        self.assertNotIn("private", str(caught.exception))
        self.assertEqual(caught.exception.code, "HTTP_401")
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.execute("SELECT 1")
        self.assertEqual(len(self.server.requests), 1)

    def test_malformed_response_invalidates_transaction(self):
        self.begin()
        self.server.response_override = lambda *_: (200, b"not-json")
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.execute("SELECT 1")
        count = len(self.server.requests)
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.commit()
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.execute("INSERT INTO fixture VALUES(1,'must-not-run',NULL)")
        self.assertEqual(len(self.server.requests), count)

    def test_uncertain_commit_is_not_replayed(self):
        self.begin()
        self.connection.execute("INSERT INTO fixture VALUES(1,'once',NULL)")

        def commit_without_acknowledgement(path, body):
            self.server.handle(path, body)
            return 503, b"upstream unavailable after commit"

        self.server.response_override = commit_without_acknowledgement
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.commit()
        count = len(self.server.requests)
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.commit()
        self.assertEqual(len(self.server.requests), count)
        self.server.response_override = None
        with closing(sqlite3.connect(self.path)) as observer:
            self.assertEqual(
                observer.execute("SELECT count(*) FROM fixture").fetchone()[0], 1
            )

    def test_untrusted_server_endpoint_is_rejected(self):
        self.server.response_override = lambda *_: (
            200,
            b'{"baton":"fixture","base_url":"https://untrusted.invalid/"}\n',
        )
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.execute("SELECT 1")
        self.assertEqual(len(self.server.requests), 1)

    def test_response_size_is_bounded(self):
        self.server.response_override = lambda *_: (200, b"x" * 32)
        with patch.object(turso_http, "MAX_RESPONSE_BYTES", 8):
            with self.assertRaises(turso_http.TursoDatabaseError):
                self.connection.execute("SELECT 1")

    def test_network_timeout_is_not_retried(self):
        requests = []

        def timeout(request):
            requests.append(request)
            raise httpx.ReadTimeout("private network detail")

        client = httpx.Client(transport=httpx.MockTransport(timeout))
        self.addCleanup(client.close)
        self.assertEqual(turso_http._get_http_client().timeout.read, 20)
        with patch.object(turso_http, "_get_http_client", return_value=client):
            connection = turso_http.connect(self.server.url, "fixture-token")
        self.addCleanup(connection.close)
        with self.assertRaises(turso_http.TursoDatabaseError) as caught:
            connection.execute("SELECT 1")
        self.assertNotIn("private", str(caught.exception))
        self.assertEqual(len(requests), 1)

    def test_pool_is_shared_but_credentials_and_streams_are_separate(self):
        second = turso_http.connect(self.server.url, "other-fixture-token")
        self.addCleanup(second.close)
        first_session = self.connection._session
        second_session = second._session
        assert isinstance(first_session, turso_http._HTTPSession)
        assert isinstance(second_session, turso_http._HTTPSession)
        self.assertIs(first_session._http, second_session._http)
        self.connection.execute("BEGIN")
        second.execute("SELECT 1")
        self.assertTrue(self.connection.in_transaction)
        self.assertFalse(second.in_transaction)
        self.assertEqual(self.server.requests[0][2], "Bearer fixture-token")
        self.assertEqual(self.server.requests[1][2], "Bearer other-fixture-token")

    def test_invalid_cursor_metadata_cannot_be_followed_by_a_successful_commit(self):
        self.server.response_override = lambda *_: (200, b"[]\n")
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.execute("SELECT 1")
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.commit()
        self.assertEqual(len(self.server.requests), 1)

    def test_missing_active_transaction_baton_cannot_restart_a_stream(self):
        self.begin()

        def omit_baton(path, body):
            status, response = self.server.handle(path, body)
            entries = response.decode("utf-8").splitlines()
            first = json.loads(entries[0])
            first["baton"] = None
            entries[0] = json.dumps(first)
            return status, ("\n".join(entries) + "\n").encode("utf-8")

        self.server.response_override = omit_baton
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.execute("SELECT 1")
        count = len(self.server.requests)
        with self.assertRaises(turso_http.TursoDatabaseError):
            self.connection.commit()
        self.assertEqual(len(self.server.requests), count)
        self.server.response_override = None

    def test_url_normalization_keeps_https_and_rejects_unsafe_configuration(self):
        for source in (
            "libsql://fixture.turso.io",
            "turso://fixture.turso.io",
            "wss://fixture.turso.io",
            "https://fixture.turso.io/",
        ):
            self.assertEqual(
                turso_http.http_database_url(source), "https://fixture.turso.io"
            )
        for source in (
            "http://fixture.invalid",
            "https://user:secret@fixture.invalid",
            "https://fixture.invalid?token=secret",
            "file:///fixture",
        ):
            with self.assertRaises(ValueError):
                turso_http.http_database_url(source)


if __name__ == "__main__":
    unittest.main()
