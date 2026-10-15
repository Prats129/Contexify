"""Focused auth regressions with disposable SQL/files and mocked providers.

Run with backend/venv/Scripts/python.exe -B backend/tests/test_auth_security.py.
No application .env, production database, mail or AI provider is used.
"""
import asyncio
import io
import json
import logging
import runpy
import sys
import tempfile
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.message import Message
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
fixture = tempfile.TemporaryDirectory(prefix="contexify-auth-")
root = Path(fixture.name)


def module(name, **attrs):
    stub = types.ModuleType(name)
    stub.__dict__.update(attrs)
    sys.modules[name] = stub


settings = types.SimpleNamespace(
    DATA_DIR=root, MEDIA_DIR=root / "media", UPLOAD_IMAGE_DIR=root / "media/uploads",
    GENERATED_IMAGE_DIR=root / "media/generated", UPLOAD_DIR=root / "uploads",
    DATABASE_TYPE="sqlite", DB_MODE="local", TURSO_DATABASE_URL="", TURSO_AUTH_TOKEN="",
    GOOGLE_CLIENT_ID="fixture-client", AUTH_SESSION_TTL_SECONDS=3600,
    GUEST_SESSION_TTL_SECONDS=600, DOWNLOAD_TICKET_TTL_SECONDS=300, ADMIN_USER_IDS=[],
    TEMPORARY_CHAT_RETENTION_DAYS=3, OTP_MAX_ATTEMPTS=3, OTP_EXPIRY_SECONDS=180,
    OTP_RESEND_COOLDOWN_SECONDS=30, OTP_MAX_SENDS_PER_HOUR=5, is_cloudflare_r2_configured=False,
    CLOUDFLARE_R2_PUBLIC_URL="", CLOUDFLARE_R2_BUCKET_NAME="fixture", r2_endpoint_url="",
    API_V1_STR="/api/v1", PROJECT_NAME="Offline auth tests", CORS_ORIGINS=[], WORKSPACE_DIR=root,
    PDF_MAX_FILE_SIZE_BYTES=25 * 1024 * 1024, PDF_MAX_PAGES=1000, PDF_MAX_TEXT_CHARS=2_000_000,
    PDF_PARSE_TIMEOUT_SECONDS=30, PDF_PARSE_MEMORY_MB=256, PDF_MAX_CONCURRENT_PARSERS=2,
    CHROMA_PERSIST_DIR=root / "chroma_db", GEMINI_API_KEY="",
)
for directory in (settings.UPLOAD_DIR, settings.MEDIA_DIR, settings.UPLOAD_IMAGE_DIR, settings.GENERATED_IMAGE_DIR):
    directory.mkdir(parents=True, exist_ok=True)
module("app.core.config", settings=settings)
logger = logging.getLogger("offline-auth")
logger.addHandler(logging.NullHandler())
logger.propagate = False
module("app.core.logging", logger=logger)
module("app.services.email_service", email_service=Mock())
vectors = Mock()
vectors.get_document_chunks.return_value = []
module("app.repositories.vector_store", vector_store_repo=vectors)
module("app.services.rag_service", rag_service=Mock())


class Orchestrator:
    emit_media = False
    last_request = None

    async def route_and_stream(self, request, principal):
        from app.services.chat_history_service import chat_history_service
        self.last_request = request
        chat_history_service.save_message(request.session_id, "user", request.message)
        if self.emit_media:
            yield 'data: {"event":"media","media":{"id":"image","url":"/api/v1/media/uploads/fixture.png","file_type":"image"}}\n\n'
        yield 'data: {"event":"done","data":"[DONE]"}\n\n'


fixture_orchestrator = Orchestrator()
module("app.services.orchestrator", chat_orchestrator=fixture_orchestrator)

# Outbound HTTP is forbidden even if a stub is accidentally bypassed.
outbound = patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected network request"))
outbound.start()
import httpx

from app.core import security
from app.db import database
from app.main import app
from app.schemas.user import UserRegisterRequest
from app.services import google_auth
from app.services.user_service import hash_password, user_service


class SecurityTests(unittest.TestCase):
    def image_fixture(self, image_format="PNG", animated=False):
        from PIL import Image

        image = Image.new("RGB", (8, 8), "red")
        output = io.BytesIO()
        if animated:
            image.save(output, format=image_format, save_all=True,
                       append_images=[Image.new("RGB", (8, 8), "blue")], duration=50, loop=0)
        else:
            image.save(output, format=image_format)
        return output.getvalue()

    def pdf_fixture(self, *texts, encrypted=False):
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

        writer = PdfWriter()
        for text in texts:
            page = writer.add_blank_page(width=612, height=792)
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                     NameObject("/Subtype"): NameObject("/Type1"),
                                     NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
            stream = DecodedStreamObject()
            stream.set_data(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii"))
            page[NameObject("/Contents")] = stream
        if encrypted:
            writer.encrypt("fixture-password")
        output = io.BytesIO()
        writer.write(output)
        return output.getvalue()

    def setUp(self):
        from app.repositories.session_store import session_store_repo
        session_store_repo._sessions.clear()
        session_store_repo._documents.clear()
        fixture_orchestrator.emit_media = False
        database.DB_FILE = root / (self.__class__.__name__ + self._testMethodName + ".db")
        database.init_db()
        self.alice = user_service.register_user(UserRegisterRequest(
            username="alice", email="alice@example.invalid", display_name="First Person", password="Durable!482Strong"))
        self.bob = user_service.register_user(UserRegisterRequest(
            username="bobby", email="bobby@example.invalid", display_name="Second Person", password="Durable!482Strong"))
        self.token = security.issue_credentials(self.alice.id)["access_token"]
        self.other_token = security.issue_credentials(self.bob.id)["access_token"]
        self.principal = security.resolve_principal(security.digest(self.token))
        security.ensure_session("alice-session", self.principal)
        with database.get_db_connection() as conn:
            conn.execute("INSERT INTO media_assets (id,user_id,session_id,filename,file_path,file_url,mime_type,created_at) "
                         "VALUES ('image',?,'alice-session','fixture.png','media/uploads/fixture.png','/api/v1/media/uploads/fixture.png','image/png',?)",
                         (self.alice.id, datetime.now(timezone.utc).replace(tzinfo=None).isoformat()))
            conn.execute("INSERT INTO documents (id,user_id,session_id,filename,file_type,file_size_bytes,total_chunks,storage_url,created_at) "
                         "VALUES ('document',?,'alice-session','fixture.txt','txt',7,1,'/api/v1/media/documents/alice-session/fixture.txt',?)",
                         (self.alice.id, datetime.now(timezone.utc).replace(tzinfo=None).isoformat()))
        (settings.UPLOAD_IMAGE_DIR / "fixture.png").write_bytes(b"fixture-image")
        directory = root / "documents/alice-session"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "fixture.txt").write_bytes(b"fixture")

    def request(self, method, path, token=None, **kwargs):
        async def send():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
                return await client.request(method, "/api/v1" + path,
                                            headers={"Authorization": "Bearer " + token} if token else {}, **kwargs)
        return asyncio.run(send())

    def test_lifespan_initializes_and_stops_background_cleanup(self):
        from app import main

        async def exercise():
            started = asyncio.Event()
            stopped = asyncio.Event()

            async def cleanup():
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    stopped.set()

            with patch.object(main, "init_db") as initialize, patch.object(
                main.chat_history_service, "purge_expired_temporary_sessions"
            ) as purge, patch.object(main, "_periodic_temporary_cleanup", cleanup):
                async with app.router.lifespan_context(app):
                    await asyncio.wait_for(started.wait(), timeout=1)
                    initialize.assert_called_once_with()
                    purge.assert_called_once_with()
                self.assertTrue(stopped.is_set())

        asyncio.run(exercise())

    def test_anonymous_resource_matrix(self):
        cases = [("GET", "/user/me", {}), ("PATCH", "/user/profile", {"json": {"user_id": self.alice.id}}),
                 ("GET", "/user/avatar/" + self.alice.id, {}),
                 ("GET", "/session/list?user_id=" + self.alice.id, {}),
                 ("POST", "/session/create", {"json": {"user_id": self.alice.id}}),
                 ("GET", "/session/alice-session/history", {}),
                 ("PATCH", "/session/alice-session/title", {"json": {"title": "Changed"}}),
                 ("PATCH", "/session/alice-session/pin", {"json": {"is_pinned": True}}),
                 ("PATCH", "/session/alice-session/mode", {"json": {"mode": "AUTO"}}),
                 ("DELETE", "/session/alice-session/messages", {}), ("DELETE", "/session/alice-session", {}),
                 ("GET", "/document/list?session_id=alice-session", {}),
                 ("GET", "/document/document/chunks", {}),
                 ("DELETE", "/document/document?session_id=alice-session", {}),
                 ("GET", "/media/assets", {}), ("GET", "/media/session/alice-session", {}),
                 ("DELETE", "/media/assets/image", {}),
                 ("GET", "/media/content/media/image", {}),
                 ("POST", "/chat/stream", {"json": {"session_id": "alice-session", "message": "hello"}}),
                 ("POST", "/document/upload", {"data": {"session_id": "alice-session"}, "files": {"file": ("fixture.txt", b"fixture")}}),
                 ("POST", "/media/upload", {"files": {"file": ("fixture.png", b"fixture", "image/png")}}),
                 ("POST", "/user/avatar", {"data": {"user_id": self.alice.id}, "files": {"file": ("fixture.png", b"fixture", "image/png")}}),
                 ("DELETE", "/user/avatar?user_id=" + self.alice.id, {}),
                 ("POST", "/user/change-password", {"json": {"user_id": self.alice.id, "old_password": "Durable!482Strong", "new_password": "Another!482Strong"}})]
        for method, path, kwargs in cases:
            with self.subTest(path=path):
                self.assertEqual(self.request(method, path, **kwargs).status_code, 401)

    def test_cross_user_matrix(self):
        cases = [("GET", "/session/alice-session/history", {}),
                 ("PATCH", "/session/alice-session/title", {"json": {"title": "Changed"}}),
                 ("DELETE", "/session/alice-session", {}),
                 ("GET", "/document/document/chunks", {}),
                 ("DELETE", "/document/document?session_id=alice-session", {}),
                 ("DELETE", "/media/assets/image", {}),
                 ("GET", "/media/content/media/image", {}),
                 ("GET", "/media/assets?session_id=alice-session", {}),
                 ("GET", "/user/me?user_id=" + self.alice.id, {}),
                 ("POST", "/session/create", {"json": {"session_id": "alice-session", "user_id": self.bob.id}}),
                 ("POST", "/chat/stream", {"json": {"session_id": "alice-session", "message": "hello"}})]
        for method, path, kwargs in cases:
            with self.subTest(path=path):
                self.assertIn(self.request(method, path, self.other_token, **kwargs).status_code, (403, 404))

    def test_owned_reads_and_default_library_are_scoped(self):
        for path in ("/user/me", "/session/alice-session/history", "/document/document/chunks", "/media/session/alice-session"):
            self.assertEqual(self.request("GET", path, self.token).status_code, 200)
        self.assertEqual(self.request("GET", "/media/assets", self.other_token).json()["total"], 0)
        self.assertEqual(self.request("GET", "/media/assets", self.token).json()["total"], 2)

    def test_forged_and_expired_credentials(self):
        self.assertEqual(self.request("GET", "/user/me", "forged").status_code, 401)
        with database.get_db_connection() as conn:
            conn.execute("UPDATE auth_sessions SET expires_at=0 WHERE token_hash=?", (self.principal.token_hash,))
        self.assertEqual(self.request("GET", "/user/me", self.token).status_code, 401)

    def test_logout_revokes_download_and_api_credentials(self):
        url = security.download_url("image", self.principal)
        self.assertEqual(self.request("GET", url.removeprefix("/api/v1")).content, b"fixture-image")
        self.assertEqual(self.request("POST", "/user/logout", self.token).status_code, 200)
        self.assertEqual(self.request("GET", "/user/me", self.token).status_code, 401)
        self.assertEqual(self.request("GET", url.removeprefix("/api/v1")).status_code, 401)

    def test_password_change_invalidates_existing_sessions(self):
        with database.get_db_connection() as conn:
            conn.execute("UPDATE users SET password_hash='changed' WHERE id=?", (self.alice.id,))
        self.assertEqual(self.request("GET", "/user/me", self.token).status_code, 401)

    def test_download_scope_expiry_and_static_bypass(self):
        url = security.download_url("document", self.principal, "document").removeprefix("/api/v1")
        self.assertEqual(self.request("GET", url).content, b"fixture")
        self.assertEqual(self.request("GET", url.replace("/document/document", "/media/image")).status_code, 401)
        with database.get_db_connection() as conn:
            conn.execute("UPDATE download_tickets SET expires_at=0")
        self.assertEqual(self.request("GET", url).status_code, 401)
        self.assertEqual(self.request("GET", "/media/uploads/fixture.png").status_code, 404)

    def test_guests_are_isolated_and_cannot_use_user_or_admin_features(self):
        first = self.request("POST", "/user/guest").json()
        second = self.request("POST", "/user/guest").json()
        payload = {"session_id": "guest-fixture", "message": "guest message"}
        self.assertEqual(self.request("POST", "/chat/stream", first["access_token"], json=payload).status_code, 200)
        self.assertEqual(self.request("POST", "/chat/stream", second["access_token"], json=payload).status_code, 404)
        self.assertEqual(self.request("GET", "/user/me", first["access_token"]).status_code, 403)
        with database.get_db_connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM messages WHERE session_id='guest-fixture'").fetchone()[0], 0)
        for path in ("/document/clear-all", "/session/purge-temporary"):
            self.assertEqual(self.request("POST", path, self.token).status_code, 403)
            settings.ADMIN_USER_IDS = [self.alice.id]
            try:
                self.assertEqual(self.request("POST", path, self.token).status_code, 200)
            finally:
                settings.ADMIN_USER_IDS = []

    def test_duplicate_session_creation_preserves_children_and_owner(self):
        from app.services.chat_history_service import chat_history_service
        chat_history_service.save_message("alice-session", "user", "Keep me")
        response = self.request("POST", "/session/create", self.token, json={"user_id": self.alice.id, "session_id": "alice-session"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["message_count"], 1)

    def test_attachment_id_is_authorized_and_url_cannot_choose_a_fetch_target(self):
        payload = {"session_id": "bob-session", "message": "hello", "attachments": [{"id": "image", "url": "http://private.invalid", "file_type": "image"}]}
        self.assertEqual(self.request("POST", "/chat/stream", self.other_token, json=payload).status_code, 404)
        payload["session_id"] = "alice-session"
        self.assertEqual(self.request("POST", "/chat/stream", self.token, json=payload).status_code, 200)

    def test_registration_and_password_login_issue_credentials(self):
        registered = self.request("POST", "/user/register", json={
            "username": "newperson", "email": "newperson@example.invalid",
            "display_name": "Third Person", "password": "Durable!482Strong",
        })
        self.assertEqual(registered.status_code, 201)
        self.assertEqual(self.request("GET", "/user/me", registered.json()["access_token"]).json()["id"], registered.json()["id"])
        response = self.request("POST", "/user/login", json={"username_or_email": "alice", "password": "Durable!482Strong"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.request("GET", "/user/me", response.json()["access_token"]).json()["id"], self.alice.id)
        self.assertNotIn("access_token", self.request("GET", "/user/me", self.token).json())

    def test_upgrade_preserves_existing_users_sessions_and_assets(self):
        # Recreate the prior schema using only this test's disposable database.
        with database.get_db_connection() as conn:
            conn.execute("DROP TABLE download_tickets")
            conn.execute("DROP TABLE auth_sessions")
            conn.execute("DROP INDEX idx_users_google_subject")
            conn.execute("ALTER TABLE users DROP COLUMN google_subject")
        database.init_db()
        database.init_db()
        response = self.request("POST", "/user/login", json={
            "username_or_email": "alice", "password": "Durable!482Strong",
        })
        self.assertEqual(response.status_code, 200)
        token = response.json()["access_token"]
        self.assertEqual(response.json()["id"], self.alice.id)
        self.assertEqual(self.request("GET", "/session/alice-session/history", token).status_code, 200)
        self.assertEqual(self.request("GET", "/media/assets", token).json()["total"], 2)
        self.assertEqual(self.request("GET", "/media/content/media/image", token).content, b"fixture-image")

    def test_otp_login_and_password_reset_credentials(self):
        def otp(identifier, purpose):
            with database.get_db_connection() as conn:
                conn.execute(
                    "INSERT INTO email_otps(id,email,otp_code,expires_at,created_at,purpose,delivery_status) VALUES(?,?,?,?,?,?,?)",
                    (identifier, self.alice.email, hash_password("123456", identifier), time.time() + 300, "2026-01-01", purpose, "sent"),
                )

        otp("login-code", "login")
        response = self.request("POST", "/user/otp/verify", json={
            "email_or_username": "alice", "otp": "123456",
        })
        self.assertEqual(response.status_code, 200)
        otp_token = response.json()["access_token"]
        self.assertEqual(self.request("GET", "/user/me", otp_token).status_code, 200)
        self.assertEqual(self.request("POST", "/user/otp/verify", json={
            "email_or_username": "alice", "otp": "123456",
        }).status_code, 400)
        otp("reset-code", "reset")
        response = self.request("POST", "/user/password-reset/verify", json={
            "email_or_username": "alice", "otp": "123456", "new_password": "Another!482Strong",
        })
        self.assertEqual(response.status_code, 200)
        for token in (self.token, otp_token):
            self.assertEqual(self.request("GET", "/user/me", token).status_code, 401)
        self.assertEqual(self.request("POST", "/user/login", json={
            "username_or_email": "alice", "password": "Another!482Strong",
        }).status_code, 200)

    def test_owned_image_avatar_uploads_and_protected_downloads(self):
        image = self.image_fixture()
        response = self.request("POST", "/media/upload", self.token,
                                data={"session_id": "alice-session"},
                                files={"file": ("../../fixture.png", image, "image/png")})
        self.assertEqual(response.status_code, 201)
        attachment = response.json()
        url = attachment["url"].removeprefix("/api/v1")
        self.assertEqual(self.request("GET", url).content, image)
        self.assertEqual(self.request("GET", "/media/content/media/" + attachment["id"], self.other_token).status_code, 404)
        avatar = self.request("POST", "/user/avatar", self.token, data={"user_id": self.alice.id},
                              files={"file": ("fixture.png", image, "image/png")})
        self.assertEqual(avatar.status_code, 200)
        avatar_url = avatar.json()["avatar_url"].removeprefix("/api/v1")
        self.assertEqual(self.request("GET", avatar_url).content, image)
        self.assertEqual(self.request("GET", "/media/content/avatar/" + self.alice.id, self.other_token).status_code, 403)
        self.assertEqual(self.request("DELETE", "/user/avatar?user_id=" + self.alice.id, self.token).status_code, 200)
        self.assertEqual(self.request("GET", avatar_url).status_code, 404)

    def test_raster_uploads_use_verified_mime_types_and_safe_download_headers(self):
        for image_format, extension, mime in (("PNG", "png", "image/png"), ("JPEG", "jpg", "image/jpeg"),
                                              ("WEBP", "webp", "image/webp"), ("GIF", "gif", "image/gif"),
                                              ("BMP", "bmp", "image/bmp")):
            with self.subTest(format=image_format):
                image = self.image_fixture(image_format)
                response = self.request("POST", "/media/upload", self.token, data={"session_id": "alice-session"},
                                        files={"file": (f"fixture.{extension}", image, "text/html")})
                self.assertEqual(response.status_code, 201)
                asset = response.json()
                self.assertEqual(asset["mime_type"], mime)
                downloaded = self.request("GET", asset["url"].removeprefix("/api/v1"))
                self.assertEqual(downloaded.content, image)
                self.assertEqual(downloaded.headers["content-type"], mime)
                self.assertEqual(downloaded.headers["x-content-type-options"], "nosniff")
                self.assertEqual(downloaded.headers["content-security-policy"], "sandbox")
                self.assertNotIn("content-disposition", downloaded.headers)

    def test_invalid_images_are_rejected_before_storage_and_registration(self):
        from app.services.storage_service import storage_service

        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>window.fixture=true</script></svg>'
        invalid = [("fixture.svg", svg), ("renamed.png", svg), ("html.jpg", b"<html>fixture</html>"),
                   ("corrupt.png", self.image_fixture()[:25]), ("mismatch.jpg", self.image_fixture()),
                   ("empty.png", b"")]
        with database.get_db_connection() as conn:
            before = conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0]
        with patch.object(storage_service, "upload_file") as upload:
            for filename, data in invalid:
                with self.subTest(filename=filename):
                    response = self.request("POST", "/media/upload", self.token, data={"session_id": "alice-session"},
                                            files={"file": (filename, data, "image/png")})
                    self.assertEqual(response.status_code, 400)
                    self.assertIsInstance(response.json()["detail"], str)
            upload.assert_not_called()
        with database.get_db_connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0], before)

    def test_image_pixel_animation_size_and_concurrency_limits(self):
        import struct
        import threading

        from app.services import image_validation

        image = self.image_fixture()
        bomb_header = bytearray(self.image_fixture("BMP"))
        struct.pack_into("<ii", bomb_header, 18, 10_000, 3_000)
        with self.assertRaises(security.HTTPException) as raised:
            image_validation.validate_image(bytes(bomb_header), "fixture.bmp")
        self.assertEqual(raised.exception.status_code, 413)
        with patch.object(image_validation, "MAX_IMAGE_PIXELS", 1), self.assertRaises(security.HTTPException) as raised:
            image_validation.validate_image(image, "fixture.png")
        self.assertEqual(raised.exception.status_code, 413)
        with self.assertRaises(security.HTTPException) as raised:
            image_validation.validate_image(image, "fixture.png", max_bytes=3)
        self.assertEqual(raised.exception.status_code, 413)
        animated = self.image_fixture("GIF", animated=True)
        for field, limit in (("MAX_IMAGE_FRAMES", 1), ("MAX_TOTAL_IMAGE_PIXELS", 65)):
            with patch.object(image_validation, field, limit), self.assertRaises(security.HTTPException) as raised:
                image_validation.validate_image(animated, "fixture.gif")
            self.assertEqual(raised.exception.status_code, 413)
        slots = threading.BoundedSemaphore(1)
        slots.acquire()
        with patch.object(image_validation, "_validation_slots", slots), self.assertRaises(security.HTTPException) as raised:
            image_validation.validate_image(image, "fixture.png")
        self.assertEqual(raised.exception.status_code, 503)
        slots.release()
        self.assertEqual(image_validation.validate_image(image, "fixture.png")[1], "image/png")

    def test_valid_animated_images_keep_their_frames(self):
        from PIL import Image

        image = self.image_fixture("GIF", animated=True)
        response = self.request("POST", "/media/upload", self.token, data={"session_id": "alice-session"},
                                files={"file": ("animated.gif", image, "image/gif")})
        self.assertEqual(response.status_code, 201)
        downloaded = self.request("GET", response.json()["url"].removeprefix("/api/v1"))
        with Image.open(io.BytesIO(downloaded.content)) as decoded:
            self.assertEqual(getattr(decoded, "n_frames", 1), 2)

    def test_invalid_avatar_preserves_previous_image_and_legacy_routes_are_safe(self):
        from app.services.storage_service import storage_service

        image = self.image_fixture()
        response = self.request("POST", "/user/avatar", self.token, data={"user_id": self.alice.id},
                                files={"file": ("fixture.png", image, "image/png")})
        self.assertEqual(response.status_code, 200)
        with patch.object(storage_service, "upload_file") as upload:
            invalid = self.request("POST", "/user/avatar", self.token, data={"user_id": self.alice.id},
                                   files={"file": ("fake.png", b"<svg>fixture</svg>", "image/png")})
            self.assertEqual(invalid.status_code, 400)
            upload.assert_not_called()
        self.assertEqual(self.request("GET", "/user/avatar/" + self.alice.id, self.token).content, image)
        # Simulate an old SVG/HTML upload mislabeled as PNG, without executing it.
        (root / "avatars" / f"{self.alice.id}.png").write_bytes(b"<svg>legacy fixture</svg>")
        for url in ("/user/avatar/" + self.alice.id, "/media/content/avatar/" + self.alice.id):
            downloaded = self.request("GET", url, self.token)
            self.assertEqual(downloaded.headers["content-type"], "application/octet-stream")
            self.assertEqual(downloaded.headers["content-disposition"], "attachment")
            self.assertEqual(downloaded.headers["x-content-type-options"], "nosniff")
            self.assertEqual(downloaded.headers["content-security-policy"], "sandbox")

    def test_legacy_active_media_is_download_only_even_with_forged_png_mime(self):
        from app.services.storage_service import storage_service

        active = b"<svg>legacy fixture</svg>"
        (settings.UPLOAD_IMAGE_DIR / "fixture.png").write_bytes(active)
        response = self.request("GET", "/media/content/media/image", self.token)
        self.assertEqual(response.content, active)
        self.assertEqual(response.headers["content-disposition"], "attachment")
        self.assertEqual(response.headers["content-type"], "application/octet-stream")
        with database.get_db_connection() as conn:
            conn.execute("UPDATE media_assets SET file_path='media/uploads/cloud-active.png' WHERE id='image'")
        client = Mock()
        client.get_object.return_value = {"Body": io.BytesIO(active)}
        with patch.object(storage_service, "_s3_client", client), patch.object(storage_service, "_initialized", True):
            response = self.request("GET", "/media/content/media/image", self.token)
        self.assertEqual(response.headers["content-disposition"], "attachment")
        self.assertEqual(response.headers["content-type"], "application/octet-stream")

    def test_cloud_and_generated_images_use_detected_content_type(self):
        from app.services.media_service import media_service
        from app.services.storage_service import storage_service

        image = self.image_fixture()
        client = Mock()
        with patch.object(storage_service, "_s3_client", client), patch.object(storage_service, "_initialized", True):
            response = self.request("POST", "/media/upload", self.token, data={"session_id": "alice-session"},
                                    files={"file": ("fixture.png", image, "text/html")})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(client.put_object.call_args.kwargs["ContentType"], "image/png")
            generated = media_service.save_generated_image(image, "fixture", "alice-session", self.alice.id, ext=".jpg")
            self.assertEqual(generated.mime_type, "image/png")
            self.assertTrue((generated.file_name or "").endswith(".png"))
            self.assertEqual(client.put_object.call_args.kwargs["ContentType"], "image/png")
            client.put_object.reset_mock()
            with self.assertRaises(security.HTTPException):
                media_service.save_generated_image(b"<svg>invalid fixture</svg>", "fixture", "alice-session", self.alice.id)
            client.put_object.assert_not_called()

    def test_cloud_documents_cannot_spoof_active_image_content_types(self):
        from app.services.storage_service import storage_service

        client = Mock()
        with patch.object(storage_service, "_s3_client", client), patch.object(storage_service, "_initialized", True):
            storage_service.upload_file(b"<svg>fixture</svg>", "documents/alice-session/fixture.txt", "image/svg+xml")
        self.assertEqual(client.put_object.call_args.kwargs["ContentType"], "application/octet-stream")
        self.assertEqual(client.put_object.call_args.kwargs["ContentDisposition"], "attachment")

    def test_document_upload_sanitizes_paths_and_removes_temporary_files(self):
        from app.repositories.session_store import session_store_repo
        from app.schemas.document import DocumentMetadata
        from app.services.rag_service import rag_service

        temporary_paths = []

        def index(file_path, filename, session_id, user_id, storage_url):
            temporary_paths.append(file_path)
            self.assertTrue(file_path.resolve().is_relative_to(settings.UPLOAD_DIR.resolve()))
            metadata = DocumentMetadata(
                document_id=f"uploaded-document-{len(temporary_paths)}", filename=filename, file_type="txt",
                file_size_bytes=len(file_path.read_bytes()), total_chunks=1,
                storage_url=storage_url, uploaded_at="2026-01-01",
            )
            session_store_repo.save_document_metadata(metadata, user_id, session_id)
            session_store_repo.attach_document_to_session(session_id, metadata.document_id)
            return metadata

        import re

        from app.services.storage_service import storage_service

        with patch.object(rag_service, "process_and_index_document", side_effect=index):
            for original, expected in (("../../fixture.txt", "fixture.txt"),
                                       (r"..\..\windows.txt", "windows.txt"),
                                       ("CON.txt", "CON.txt"), ("fixture:stream.txt", "fixture:stream.txt")):
                with self.subTest(filename=original):
                    response = self.request("POST", "/document/upload", self.token,
                                            data={"session_id": "alice-session"},
                                            files={"file": (original, b"uploaded document", "text/plain")})
                    self.assertEqual(response.status_code, 201)
                    document = response.json()["document"]
                    self.assertEqual(document["filename"], expected)
                    with database.get_db_connection() as conn:
                        stored = conn.execute("SELECT storage_url FROM documents WHERE id=?", (document["document_id"],)).fetchone()[0]
                    key = storage_service.owned_storage_key({"storage_url": stored}, "document")
                    self.assertIsNotNone(re.fullmatch(r"documents/alice-session/[0-9a-f]{32}\.txt", key))
                    self.assertEqual(self.request("GET", document["storage_url"].removeprefix("/api/v1")).content, b"uploaded document")
        self.assertTrue(temporary_paths)
        self.assertTrue(all(not path.exists() for path in temporary_paths))

    def test_upload_rejects_path_shaped_session_ids_before_file_writes(self):
        from app.services.rag_service import rag_service
        from app.services.storage_service import storage_service

        with patch.object(rag_service, "process_and_index_document") as index, patch.object(storage_service, "upload_file") as upload:
            for session in ("../outside", r"..\outside", "/absolute", "C:/absolute", "nested/session", "%2e%2e", "x" * 129):
                for path in ("/document/upload", "/media/upload"):
                    with self.subTest(session=session, path=path):
                        response = self.request("POST", path, self.token, data={"session_id": session},
                                                files={"file": ("fixture.txt" if path.startswith("/document") else "fixture.png", b"fixture", "application/octet-stream")})
                        self.assertEqual(response.status_code, 400)
            index.assert_not_called()
            upload.assert_not_called()

    def test_storage_rejects_unsafe_keys_before_disk_or_r2_writes(self):
        from app.services.storage_service import storage_service

        data = root / (self.__class__.__name__ + "-storage-keys")
        data.mkdir()
        client = Mock()
        keys = ("", "/absolute.txt", "../outside.txt", "media/../../outside.txt", r"..\outside.txt",
                "C:/outside.txt", r"\\host\share\outside.txt", "media/file.txt:stream.txt",
                "media/CON.txt", "media/NUL.txt", "media/file.txt.", "media/file.txt ",
                "media//file.txt", "media/./file.txt", "media/invalid\x00.txt")
        with patch.object(settings, "DATA_DIR", data), patch.object(storage_service, "_s3_client", client):
            for cloud in (False, True):
                with patch.object(storage_service, "_initialized", cloud):
                    for key in keys:
                        with self.subTest(cloud=cloud, key=key), self.assertRaises(ValueError):
                            storage_service.upload_file(b"fixture", key)
            client.put_object.assert_not_called()
        self.assertEqual(list(data.iterdir()), [])

    def test_storage_valid_keys_work_in_local_r2_and_cloud_fallback_modes(self):
        from app.services.storage_service import storage_service

        data = root / (self.__class__.__name__ + "-storage-valid")
        data.mkdir()
        client = Mock()
        with patch.object(settings, "DATA_DIR", data), patch.object(storage_service, "_s3_client", client):
            with patch.object(storage_service, "_initialized", False):
                _, key = storage_service.upload_file(b"local", "documents/session/object.txt")
                self.assertEqual((data / key).read_bytes(), b"local")
            with patch.object(storage_service, "_initialized", True):
                _, key = storage_service.upload_file(b"cloud", "media/uploads/object.png")
                self.assertEqual(key, "media/uploads/object.png")
                self.assertEqual(client.put_object.call_args.kwargs["Key"], key)
                self.assertFalse((data / key).exists())
                client.put_object.side_effect = RuntimeError("fixture provider failure")
                _, key = storage_service.upload_file(b"fallback", "media/generated/object.png")
                self.assertEqual((data / key).read_bytes(), b"fallback")

    @unittest.skipUnless(sys.platform == "win32", "Windows junction regression")
    def test_storage_upload_blocks_junction_writes_outside_data_root(self):
        import _winapi

        from app.services.storage_service import storage_service

        data = root / (self.__class__.__name__ + "-storage-junction")
        data.mkdir()
        outside = root / (self.__class__.__name__ + "-outside-storage")
        outside.mkdir()
        sentinel = outside / "fixture.txt"
        sentinel.write_bytes(b"unchanged")
        _winapi.CreateJunction(str(outside), str(data / "linked"))
        client = Mock()
        with patch.object(settings, "DATA_DIR", data), patch.object(storage_service, "_s3_client", client), patch.object(storage_service, "_initialized", True):
            with self.assertRaises(ValueError):
                storage_service.upload_file(b"overwrite", "linked/fixture.txt")
            client.put_object.assert_not_called()
        self.assertEqual(sentinel.read_bytes(), b"unchanged")

    def test_document_index_failure_still_removes_temporary_upload(self):
        from app.services.rag_service import rag_service

        paths = []

        def fail(**kwargs):
            paths.append(kwargs["file_path"])
            raise RuntimeError("fixture index failure")

        with patch.object(rag_service, "process_and_index_document", side_effect=fail):
            response = self.request("POST", "/document/upload", self.token, data={"session_id": "alice-session"},
                                    files={"file": ("../../fixture.txt", b"fixture", "text/plain")})
        self.assertEqual(response.status_code, 500)
        self.assertTrue(paths)
        self.assertTrue(all(not path.exists() for path in paths))

    def test_pdf_worker_preserves_page_numbers_and_chunk_citations(self):
        from app.services.pdf_service import extract_pdf_pages

        path = root / "extraction-fixture.pdf"
        path.write_bytes(self.pdf_fixture("First page fixture text for indexing.", "", "Third page fixture text for indexing."))
        pages = extract_pdf_pages(path)
        self.assertEqual([number for _, number in pages], [1, 3])
        self.assertIn("Third page fixture", pages[1][0])
        embedding = types.ModuleType("app.services.embedding_service")
        embedder = Mock()
        embedder.embed_batch.side_effect = lambda texts: [[1.0] for _ in texts]
        setattr(embedding, "embedding_service", embedder)
        with patch.dict(sys.modules, {embedding.__name__: embedding}), patch.multiple(
            settings, CHUNK_SIZE=800, CHUNK_OVERLAP=150, TOP_K_RETRIEVAL=4, SIMILARITY_THRESHOLD=0.2, create=True
        ):
            actual = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app/services/rag_service.py"))["rag_service"]
        with patch.object(actual, "extract_text_from_file", side_effect=AssertionError("Do not parse twice")):
            metadata = actual.process_and_index_document(path, "fixture.pdf", "alice-session", self.alice.id, extracted_pages=pages)
        self.assertEqual(metadata.total_chunks, 2)
        self.assertEqual([item["page_number"] for item in vectors.add_chunks.call_args.kwargs["metadatas"]], [1, 3])
        from app.api.v1.endpoints import document

        with patch.object(document, "rag_service", actual):
            response = self.request("POST", "/document/upload", self.token, data={"session_id": "alice-session"},
                                    files={"file": ("fixture.pdf", path.read_bytes(), "application/pdf")})
        self.assertEqual(response.status_code, 201)
        uploaded = response.json()["document"]
        self.assertEqual(uploaded["total_chunks"], 2)
        self.assertEqual(self.request("GET", uploaded["storage_url"].removeprefix("/api/v1")).content, path.read_bytes())

    def test_pdf_parsing_does_not_block_health_requests(self):
        import threading

        from app.api.v1.endpoints import document
        from app.services.pdf_service import PDFProcessingError

        started = threading.Event()
        release = threading.Event()

        def wait_for_release(path):
            started.set()
            release.wait(timeout=3)
            raise PDFProcessingError("fixture rejection")

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
                upload = asyncio.create_task(client.post("/api/v1/document/upload",
                    headers={"Authorization": "Bearer " + self.token}, data={"session_id": "alice-session"},
                    files={"file": ("fixture.pdf", b"fixture", "application/pdf")}))
                try:
                    for _ in range(100):
                        if started.is_set():
                            break
                        await asyncio.sleep(0.01)
                    self.assertTrue(started.is_set())
                    self.assertFalse(upload.done())
                    health = await asyncio.wait_for(client.get("/api/v1/health"), timeout=1)
                    self.assertEqual(health.status_code, 200)
                    self.assertFalse(upload.done())
                finally:
                    release.set()
                    response = await upload
                self.assertEqual(response.status_code, 422)

        with patch.object(document.rag_service, "extract_text_from_file", side_effect=wait_for_release):
            asyncio.run(exercise())

    def test_pdf_worker_rejects_page_text_size_and_encryption_limits(self):
        from app.services.pdf_service import PDFProcessingError, extract_pdf_pages

        path = root / "limits-fixture.pdf"
        path.write_bytes(self.pdf_fixture("First fixture page", "Second fixture page"))
        for field, value in (("PDF_MAX_PAGES", 1), ("PDF_MAX_TEXT_CHARS", 3), ("PDF_MAX_FILE_SIZE_BYTES", 3)):
            with self.subTest(limit=field), patch.object(settings, field, value), self.assertRaises(PDFProcessingError) as raised:
                extract_pdf_pages(path)
            self.assertEqual(raised.exception.status_code, 413)
        path.write_bytes(self.pdf_fixture("Encrypted fixture", encrypted=True))
        with self.assertRaises(PDFProcessingError) as raised:
            extract_pdf_pages(path)
        self.assertEqual(raised.exception.status_code, 422)

    def test_pdf_timeout_kills_and_reaps_worker_and_releases_slot(self):
        import threading

        from app.services import pdf_service

        script = root / "slow-pdf-fixture.py"
        script.write_text("import time; time.sleep(10)", encoding="utf-8")
        path = root / "timeout-fixture.pdf"
        path.write_bytes(b"fixture")
        slots = threading.BoundedSemaphore(1)
        with patch.object(pdf_service, "_worker", script), patch.object(pdf_service, "_slots", slots), patch.object(
            settings, "PDF_PARSE_TIMEOUT_SECONDS", 0.1
        ), self.assertRaises(pdf_service.PDFProcessingError) as raised:
            pdf_service.extract_pdf_pages(path)
        self.assertIn("timed out", str(raised.exception))
        self.assertTrue(slots.acquire(blocking=False))
        slots.release()

    def test_pdf_concurrency_limit_rejects_without_starting_another_worker(self):
        import threading

        from app.services import pdf_service

        path = root / "busy-fixture.pdf"
        path.write_bytes(b"fixture")
        slots = threading.BoundedSemaphore(1)
        slots.acquire()
        with patch.object(pdf_service, "_slots", slots), patch.object(pdf_service.subprocess, "Popen") as spawn:
            with self.assertRaises(pdf_service.PDFProcessingError) as raised:
                pdf_service.extract_pdf_pages(path)
            self.assertEqual(raised.exception.status_code, 503)
            spawn.assert_not_called()
        slots.release()

    def test_pdf_upload_limits_reject_before_storage_or_index_and_cleanup(self):
        from app.api.v1.endpoints import document
        from app.services.pdf_service import extract_pdf_pages
        from app.services.storage_service import storage_service

        before = set(settings.UPLOAD_DIR.iterdir())
        with patch.object(document.rag_service, "extract_text_from_file", side_effect=extract_pdf_pages), patch.object(
            document.rag_service, "process_and_index_document"
        ) as index, patch.object(storage_service, "upload_file") as upload:
            response = self.request("POST", "/document/upload", self.token, data={"session_id": "alice-session"},
                                    files={"file": ("malformed.pdf", b"invalid fixture", "application/pdf")})
            self.assertEqual(response.status_code, 422)
            with patch.object(settings, "PDF_MAX_FILE_SIZE_BYTES", 3):
                response = self.request("POST", "/document/upload", self.token, data={"session_id": "alice-session"},
                                        files={"file": ("large.pdf", b"oversized fixture", "application/pdf")})
            self.assertEqual(response.status_code, 413)
            index.assert_not_called()
            upload.assert_not_called()
        self.assertEqual(set(settings.UPLOAD_DIR.iterdir()), before)

    def test_pdf_resource_limit_blocks_large_allocation_in_child(self):
        import subprocess

        from app.services import pdf_service

        # Exercise the OS memory limit using an allocation, not a hostile PDF.
        code = (
            "import runpy; "
            f"worker=runpy.run_path({str(pdf_service._worker)!r}); "
            "job=worker['apply_resource_limits'](64, 10)\n"
            "try:\n data=bytearray(128*1024*1024)\nexcept MemoryError:\n print('bounded')\n"
        )
        result = subprocess.run([sys.executable, "-I", "-B", "-c", code], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "bounded")

    def test_partial_temporary_write_failure_cleans_up_without_indexing(self):
        from app.api.v1.endpoints import document

        path = settings.UPLOAD_DIR / "partial-write-fixture.txt"
        path.write_bytes(b"partial fixture")
        writer = Mock(name=str(path))
        writer.name = str(path)
        writer.write.side_effect = OSError("fixture write failure")
        manager = Mock()
        manager.__enter__ = Mock(return_value=writer)
        manager.__exit__ = Mock(return_value=False)
        with patch.object(document.tempfile, "NamedTemporaryFile", return_value=manager), patch.object(
            document.rag_service, "process_and_index_document"
        ) as index:
            response = self.request("POST", "/document/upload", self.token, data={"session_id": "alice-session"},
                                    files={"file": ("fixture.txt", b"fixture", "text/plain")})
        self.assertEqual(response.status_code, 500)
        self.assertFalse(path.exists())
        index.assert_not_called()


    def test_document_attachments_are_persisted_and_route_to_grounding(self):
        from app.api.v1.endpoints import chat
        from app.services.rag_service import rag_service
        providers = {}
        for name, attribute in (("llm_service", "llm_service"), ("image_gen_service", "image_gen_service"), ("web_search_service", "web_search_service")):
            stub = types.ModuleType("app.services." + name)
            setattr(stub, attribute, Mock())
            providers[stub.__name__] = stub
        with patch.dict(sys.modules, providers):
            implementation = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"))
        actual = implementation["chat_orchestrator"]
        context = [{"text": "fixture document", "metadata": {"document_id": "document"}, "similarity_score": 1.0}]

        async def grounded(query, session_id, history, **kwargs):
            self.assertEqual(kwargs["context_chunks"], context)
            yield 'data: {"event":"done","data":"[DONE]"}\n\n'

        async def vision(*args, **kwargs):
            raise AssertionError("Documents must not enter the vision route")
            yield ""

        with patch.object(chat, "chat_orchestrator", actual), patch.object(actual, "_execute_document_rag", grounded), patch.object(actual, "_execute_multimodal", vision), patch.object(rag_service, "retrieve_context_for_query", return_value=context) as retrieve:
            for mode in ("AUTO", "DOCUMENT_RAG", "MULTIMODAL"):
                response = self.request("POST", "/chat/stream", self.token, json={
                    "session_id": "alice-session", "message": "review", "mode": mode,
                    "attachments": [{"id": "document", "file_type": "document", "url": "http://untrusted.invalid"}],
                })
                self.assertEqual(response.status_code, 200)
                retrieve.assert_called_with("review", "alice-session", document_ids=["document"])
        history = self.request("GET", "/session/alice-session/history", self.token).json()
        attachment = history["messages"][-1]["attachments"][0]
        self.assertEqual(attachment["file_type"], "document")
        self.assertEqual(attachment["file_name"], "fixture.txt")
        self.assertEqual(self.request("GET", attachment["url"].removeprefix("/api/v1")).content, b"fixture")
        denied = self.request("POST", "/chat/stream", self.other_token, json={
            "session_id": "bob-session", "message": "review", "attachments": [{"id": "document", "file_type": "document", "url": "ignored"}],
        })
        self.assertEqual(denied.status_code, 404)

    def test_grounding_honors_explicit_document_selection(self):
        embedding = types.ModuleType("app.services.embedding_service")
        embedder = Mock()
        embedder.embed_text.return_value = [1.0]
        setattr(embedding, "embedding_service", embedder)
        with patch.dict(sys.modules, {embedding.__name__: embedding}), patch.multiple(
            settings, CHUNK_SIZE=800, CHUNK_OVERLAP=150, TOP_K_RETRIEVAL=4, SIMILARITY_THRESHOLD=0.2, create=True
        ):
            implementation = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app/services/rag_service.py"))
            actual = implementation["rag_service"]
            with patch.object(vectors, "similarity_search", return_value=[]) as search:
                self.assertEqual(actual.retrieve_context_for_query("review", "alice-session", document_ids=["selected-fixture"]), [])
                self.assertEqual(search.call_args.kwargs["document_ids"], ["selected-fixture"])
                search.reset_mock()
                self.assertEqual(actual.retrieve_context_for_query("review", "alice-session", document_ids=[]), [])
                search.assert_not_called()

    def test_real_orchestrator_streams_owned_media_without_external_requests(self):
        from app.api.v1.endpoints import chat
        from app.services.media_service import media_service

        async def answer(*args, **kwargs):
            yield "Offline answer"

        async def vision(*args, **kwargs):
            self.assertEqual(media_service.get_media_bytes(kwargs["attachments"][0].url), b"fixture-image")
            yield "Offline vision"

        providers = {}
        for name, attribute in (("llm_service", "llm_service"), ("image_gen_service", "image_gen_service"),
                                ("web_search_service", "web_search_service")):
            stub = types.ModuleType("app.services." + name)
            setattr(stub, attribute, Mock(stream_conversational_answer=answer, stream_multimodal_answer=vision))
            providers[stub.__name__] = stub
        with patch.dict(sys.modules, providers):
            implementation = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"))
        with patch.object(chat, "chat_orchestrator", implementation["chat_orchestrator"]):
            for mode, attachments, expected in (("AUTO", [], "Offline answer"),
                                               ("MULTIMODAL", [{"id": "image", "file_type": "image", "url": "http://internal.invalid"}], "Offline vision")):
                response = self.request("POST", "/chat/stream", self.token, json={
                    "session_id": "alice-session", "message": "hello", "mode": mode, "attachments": attachments,
                })
                self.assertEqual(response.status_code, 200)
                self.assertIn(expected, response.text)
                self.assertNotIn('"event": "error"', response.text)

    def test_production_spa_serves_build_and_blocks_private_paths(self):
        distribution = root / "frontend/dist"
        distribution.mkdir(parents=True, exist_ok=True)
        (distribution / "index.html").write_text("fixture frontend", encoding="utf-8")
        (distribution / "public.txt").write_text("fixture public file", encoding="utf-8")
        assets = distribution / "assets"
        assets.mkdir(exist_ok=True)
        (assets / "main.js").write_text("fixture asset", encoding="utf-8")
        (root / "private-fixture.txt").write_text("private fixture", encoding="utf-8")
        production = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app/main.py"))["app"]

        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=production), base_url="http://fixture.invalid") as client:
                self.assertEqual((await client.get("/c/alice-session")).text, "fixture frontend")
                self.assertEqual((await client.get("/public.txt")).text, "fixture public file")
                self.assertEqual((await client.get("/assets/main.js")).text, "fixture asset")
                for path in (
                    "/%2e%2e/%2e%2e/private-fixture.txt",
                    "/..%5c..%5cprivate-fixture.txt",
                    "/assets/..%5c..%5c..%5cprivate-fixture.txt",
                    "/api", "/api/", "/api/v1/not-a-route",
                    "/api%5cv1%5cnot-a-route", "/%2e/api", "/other/%2e%2e/api",
                    "/api/v1/media/uploads/fixture.png", "/docs/not-a-route",
                ):
                    with self.subTest(path=path):
                        self.assertEqual((await client.get(path)).status_code, 404)

        asyncio.run(check())

    @unittest.skipUnless(sys.platform == "win32", "Windows junction regression")
    def test_production_spa_blocks_junction_escapes(self):
        import _winapi

        distribution = root / "frontend/dist"
        assets = distribution / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        (distribution / "index.html").write_text("fixture frontend", encoding="utf-8")
        outside = root / (self.__class__.__name__ + "-junction-fixture")
        outside.mkdir()
        (outside / "private.txt").write_text("private fixture", encoding="utf-8")
        link_name = self.__class__.__name__ + "-linked"
        _winapi.CreateJunction(str(outside), str(distribution / link_name))
        _winapi.CreateJunction(str(outside), str(assets / link_name))
        production = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app/main.py"))["app"]

        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=production), base_url="http://fixture.invalid") as client:
                for path in (f"/{link_name}/private.txt", f"/assets/{link_name}/private.txt"):
                    with self.subTest(path=path):
                        response = await client.get(path)
                        self.assertEqual(response.status_code, 404)
                        self.assertNotIn("private fixture", response.text)

        asyncio.run(check())

    def test_direct_email_google_login_is_rejected(self):
        self.assertEqual(self.request("POST", "/user/auth/google", json={"email": self.alice.email}).status_code, 422)

    def test_profile_and_upload_identity_cannot_be_overridden(self):
        for method, path, kwargs in (
            ("PATCH", "/user/profile", {"json": {"user_id": self.alice.id, "display_name": "Attacker"}}),
            ("POST", "/media/upload", {"data": {"user_id": self.alice.id}, "files": {"file": ("fixture.png", b"fixture", "image/png")}}),
            ("POST", "/document/upload", {"data": {"session_id": "alice-session"}, "files": {"file": ("fixture.txt", b"fixture")}}),
        ):
            with self.subTest(path=path):
                self.assertIn(self.request(method, path, self.other_token, **kwargs).status_code, (403, 404))

    def test_guest_document_metadata_has_owned_downloads(self):
        from app.services.chat_history_service import chat_history_service
        guest = security.create_guest()
        principal = security.resolve_principal(security.digest(guest["access_token"]))
        security.ensure_session("guest-document-session", principal)
        chat_history_service.save_document("guest-document", principal.user_id, "guest-document-session",
                                           "fixture.txt", "txt", 7, 1, "documents/alice-session/fixture.txt")
        url = security.download_url("guest-document", principal, "document").removeprefix("/api/v1")
        self.assertEqual(self.request("GET", url).content, b"fixture")
        self.assertEqual(self.request("GET", "/document/guest-document/chunks", self.token).status_code, 404)

    def test_unowned_legacy_assets_are_denied_and_missing_attachments_do_not_break_history(self):
        from app.services.chat_history_service import chat_history_service
        with database.get_db_connection() as conn:
            conn.execute("UPDATE media_assets SET user_id=NULL,session_id=NULL WHERE id='image'")
        self.assertEqual(self.request("GET", "/media/content/media/image", self.token).status_code, 404)
        chat_history_service.save_message("alice-session", "user", "Old message", attachments=[{"url": "/legacy.png"}])
        response = self.request("GET", "/session/alice-session/history", self.token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["messages"][0]["attachments"], [])

    def test_legacy_generated_asset_derives_owner_from_session(self):
        with database.get_db_connection() as conn:
            conn.execute("UPDATE media_assets SET user_id=NULL WHERE id='image'")
        response = self.request("GET", "/media/assets", self.token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 2)
        self.assertEqual(self.request("GET", "/media/content/media/image", self.token).content, b"fixture-image")

    def test_verified_google_subject_is_persistent_and_client_email_is_ignored(self):
        import app.services.user_service as service_module
        claims = {"sub": "google-fixture", "email": "new@gmail.com", "name": "Google Person", "email_verified": True}
        with patch.object(service_module, "verify_google_credential", return_value=claims):
            first = self.request("POST", "/user/auth/google", json={"credential": "verified-by-fixture", "email": self.alice.email})
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["email"], "new@gmail.com")
            claims["email"] = "changed@gmail.com"
            second = self.request("POST", "/user/auth/google", json={"credential": "verified-by-fixture"})
            self.assertEqual(second.json()["id"], first.json()["id"])

    def test_third_party_email_cannot_automatically_link_to_existing_account(self):
        import app.services.user_service as service_module
        claims = {"sub": "google-fixture", "email": self.alice.email, "email_verified": True}
        with patch.object(service_module, "verify_google_credential", return_value=claims):
            self.assertEqual(self.request("POST", "/user/auth/google", json={"credential": "verified-by-fixture"}).status_code, 409)

    def test_cloud_file_download_uses_exact_owned_key_without_http_fallback(self):
        from app.services.storage_service import storage_service
        with database.get_db_connection() as conn:
            conn.execute("UPDATE media_assets SET file_path='media/uploads/cloud-fixture.png' WHERE id='image'")
        body = io.BytesIO(b"cloud fixture")
        client = Mock()
        client.get_object.return_value = {"Body": body}
        with patch.object(storage_service, "_s3_client", client), patch.object(storage_service, "_initialized", True):
            response = self.request("GET", "/media/content/media/image", self.token)
        self.assertEqual(response.content, b"cloud fixture")
        client.get_object.assert_called_once_with(Bucket="fixture", Key="media/uploads/cloud-fixture.png")
        self.assertTrue(body.closed)

    def test_generated_stream_media_gets_an_owned_download_ticket(self):
        fixture_orchestrator.emit_media = True
        response = self.request("POST", "/chat/stream", self.token, json={"session_id": "alice-session", "message": "hello"})
        event = json.loads(response.text.split("\n\n")[0].removeprefix("data: "))
        url = event["media"]["url"].removeprefix("/api/v1")
        self.assertEqual(self.request("GET", url).content, b"fixture-image")

    def test_storage_reads_reject_urls_paths_and_unsafe_keys_before_r2(self):
        from app.services.storage_service import storage_service

        private = root / "private-read-fixture.txt"
        private.write_bytes(b"private fixture")
        client = Mock()
        keys = ["", str(private), "../private-read-fixture.txt", "media/../private-read-fixture.txt",
                "media//uploads/fixture.png", r"media\uploads\fixture.png", "media/uploads/CON.txt",
                "media/uploads/fixture.png:stream", "media/uploads/fixture.png.", "private-read-fixture.txt",
                "http://127.0.0.1/private", "http://169.254.169.254/latest/meta-data/",
                "file:///private", "//internal.invalid/media/uploads/fixture.png"]
        with patch.object(storage_service, "_s3_client", client), patch.object(storage_service, "_initialized", True):
            for key in keys:
                with self.subTest(key=key):
                    self.assertIsNone(storage_service.download_owned_file(key))
                    self.assertIsNone(storage_service.download_file(key))
            client.get_object.assert_not_called()

    def test_storage_url_resolution_requires_exact_configured_origin_and_prefix(self):
        from app.services.storage_service import storage_service

        key = "media/uploads/fixture.png"
        with patch.object(settings, "CLOUDFLARE_R2_PUBLIC_URL", "https://cdn.fixture.invalid/files"), patch.object(
            settings, "r2_endpoint_url", "https://r2.fixture.invalid"
        ), patch.object(storage_service, "download_owned_file", return_value=b"fixture") as read:
            for url in ("https://cdn.fixture.invalid/files/" + key,
                        "https://r2.fixture.invalid/fixture/" + key,
                        "/api/v1/media/uploads/fixture.png?ticket=fixture"):
                self.assertEqual(storage_service.download_file(url), b"fixture")
                read.assert_called_with(key)
            for url in ("https://cdn.fixture.invalid.evil.invalid/files/" + key,
                        "https://evil.invalid/fixture/" + key,
                        "https://evil.invalid/https://cdn.fixture.invalid/files/" + key,
                        "https://cdn.fixture.invalid/filesevil/" + key,
                        "https://cdn.fixture.invalid:444/files/" + key,
                        "https://user@cdn.fixture.invalid/files/" + key,
                        "https://cdn.fixture.invalid/files/media/%2e%2e/private.txt"):
                self.assertIsNone(storage_service._extract_key_from_url(url))
                with self.assertRaises(security.HTTPException):
                    storage_service.owned_storage_key({"file_path": url}, "media")

    def test_owned_downloads_bound_reads_and_close_cloud_bodies(self):
        from app.services.storage_service import storage_service

        self.assertIsNone(storage_service.download_owned_file("media/uploads/fixture.png", max_bytes=3))
        self.assertEqual(storage_service.download_owned_file("media/uploads/fixture.png", max_bytes=13), b"fixture-image")
        for declared in (0, 100):
            body = io.BytesIO(b"oversized fixture")
            client = Mock()
            client.get_object.return_value = {"Body": body, "ContentLength": declared}
            with patch.object(storage_service, "_s3_client", client), patch.object(storage_service, "_initialized", True):
                self.assertIsNone(storage_service.download_owned_file("media/uploads/cloud-limit.png", max_bytes=3))
            self.assertTrue(body.closed)

    def test_cloud_failure_never_falls_back_to_http(self):
        from app.services.storage_service import storage_service

        client = Mock()
        client.get_object.side_effect = RuntimeError("fixture storage failure")
        with patch.object(storage_service, "_s3_client", client), patch.object(storage_service, "_initialized", True), patch.object(
            settings, "CLOUDFLARE_R2_PUBLIC_URL", "https://cdn.fixture.invalid"
        ), patch.object(httpx, "Client", side_effect=AssertionError("HTTP fallback is forbidden")):
            self.assertIsNone(storage_service.download_file("https://cdn.fixture.invalid/media/uploads/cloud-missing.png"))
        client.get_object.assert_called_once_with(Bucket="fixture", Key="media/uploads/cloud-missing.png")

    @unittest.skipUnless(sys.platform == "win32", "Windows junction regression")
    def test_owned_downloads_reject_junctions_into_private_data(self):
        import _winapi

        from app.services.storage_service import storage_service

        data = root / (self.__class__.__name__ + "-read-junction")
        (data / "media").mkdir(parents=True)
        private = data / "private"
        private.mkdir()
        (private / "fixture.txt").write_bytes(b"private fixture")
        _winapi.CreateJunction(str(private), str(data / "media/linked"))
        client = Mock()
        with patch.object(settings, "DATA_DIR", data), patch.object(storage_service, "_s3_client", client), patch.object(
            storage_service, "_initialized", True
        ):
            self.assertIsNone(storage_service.download_owned_file("media/linked/fixture.txt"))
            client.get_object.assert_not_called()

    def test_vision_reads_only_media_keys_with_the_upload_size_limit(self):
        from app.services import media_service as implementation
        from app.services.storage_service import storage_service

        with patch.object(implementation, "MAX_FILE_SIZE_BYTES", 3):
            self.assertIsNone(implementation.media_service.get_media_bytes("media/uploads/fixture.png"))
        with patch.object(storage_service, "download_owned_file") as read:
            self.assertIsNone(implementation.media_service.get_media_bytes("documents/alice-session/fixture.txt"))
            self.assertIsNone(implementation.media_service.get_media_bytes("http://internal.invalid"))
            read.assert_not_called()

    def test_reference_generation_uses_owned_keys_in_local_and_cloud_modes(self):
        from app.api.v1.endpoints import chat
        from app.schemas.chat import MediaAttachment
        from app.services.media_service import media_service
        from app.services.storage_service import storage_service

        async def reference(**kwargs):
            self.assertTrue(kwargs["reference_image_path"].startswith("media/uploads/"))
            self.assertEqual(media_service.get_media_bytes(kwargs["reference_image_path"]), b"fixture-image")
            return MediaAttachment(id="image", url="ignored", file_type="image")

        providers = {}
        for name in ("llm_service", "image_gen_service", "web_search_service"):
            stub = types.ModuleType("app.services." + name)
            setattr(stub, name, Mock())
            providers[stub.__name__] = stub
        generator = getattr(providers["app.services.image_gen_service"], "image_gen_service")
        generator.generate_from_reference = AsyncMock(side_effect=reference)
        generator.generate_image = AsyncMock(side_effect=AssertionError("Must use the attached reference"))
        with patch.dict(sys.modules, providers):
            actual = runpy.run_path(str(Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"))["chat_orchestrator"]
        client = Mock()
        client.get_object.side_effect = lambda **kwargs: {"Body": io.BytesIO(b"fixture-image")}
        with patch.object(chat, "chat_orchestrator", actual), patch.object(storage_service, "_s3_client", client):
            for cloud in (False, True):
                key = "media/uploads/cloud-reference.png" if cloud else "media/uploads/fixture.png"
                with database.get_db_connection() as conn:
                    conn.execute("UPDATE media_assets SET file_path=? WHERE id='image'", (key,))
                with patch.object(storage_service, "_initialized", cloud):
                    response = self.request("POST", "/chat/stream", self.token, json={
                        "session_id": "alice-session", "message": "Generate a new image using this reference", "mode": "IMAGE_GENERATION",
                        "attachments": [{"id": "image", "file_type": "image", "url": "http://internal.invalid"}],
                    })
                self.assertEqual(response.status_code, 200)
                self.assertNotIn('"event": "error"', response.text)
                self.assertIn('"event": "media"', response.text)
        self.assertEqual(generator.generate_from_reference.await_count, 2)
        generator.generate_image.assert_not_called()

    def test_incoming_attachment_url_is_replaced_with_owned_storage_key(self):
        response = self.request("POST", "/chat/stream", self.token, json={
            "session_id": "alice-session", "message": "hello",
            "attachments": [{"id": "image", "file_type": "image", "url": "http://internal.invalid/secret"}],
        })
        self.assertEqual(response.status_code, 200)
        assert fixture_orchestrator.last_request is not None
        self.assertEqual(fixture_orchestrator.last_request.attachments[0].url, "media/uploads/fixture.png")

    def issue_otp(self, purpose="login", delivered=True):
        from app.services import user_service as service_module
        sender = AsyncMock(return_value=delivered)
        method = "send_otp_email" if purpose == "login" else "send_password_reset_otp_email"
        path = "/user/otp/send" if purpose == "login" else "/user/password-reset/send"
        with patch.object(service_module.email_service, method, sender):
            response = self.request("POST", path, json={"email_or_username": "alice"})
        return response, sender.call_args.kwargs["otp_code"] if sender.called else None

    def verify_otp(self, code, purpose="login"):
        payload = {"email_or_username": "alice", "otp": code}
        path = "/user/otp/verify"
        if purpose == "reset":
            path = "/user/password-reset/verify"
            payload["new_password"] = "Another!482Strong"
        return self.request("POST", path, json=payload)

    def test_wrong_otp_attempts_commit_and_revoke_for_each_purpose(self):
        for purpose in ("login", "reset"):
            with database.get_db_connection() as conn:
                conn.execute("DELETE FROM email_otps")
            sent, code = self.issue_otp(purpose)
            self.assertEqual(sent.status_code, 200)
            wrong = "000000"
            for attempt in range(1, 4):
                self.assertEqual(self.verify_otp(wrong, purpose).status_code, 400)
                with database.get_db_connection() as conn:
                    row = conn.execute("SELECT attempts,is_used,otp_code FROM email_otps").fetchone()
                    self.assertEqual(row["attempts"], attempt)
                    self.assertEqual(row["is_used"], int(attempt == 3))
                    self.assertNotEqual(row["otp_code"], code)
            self.assertEqual(self.verify_otp(code, purpose).status_code, 400)

    def test_otp_is_bound_to_purpose_and_expiry(self):
        sent, code = self.issue_otp()
        self.assertEqual(sent.status_code, 200)
        self.assertEqual(self.verify_otp(code, "reset").status_code, 400)
        self.assertEqual(self.verify_otp(code).status_code, 200)
        with database.get_db_connection() as conn:
            conn.execute("UPDATE email_otps SET requested_at = requested_at - 31")
        _, reset_code = self.issue_otp("reset")
        self.assertEqual(self.verify_otp(reset_code).status_code, 400)
        with database.get_db_connection() as conn:
            conn.execute("UPDATE email_otps SET expires_at = 0")
        self.assertEqual(self.verify_otp(reset_code, "reset").status_code, 400)
        with database.get_db_connection() as conn:
            self.assertEqual(conn.execute("SELECT is_used FROM email_otps WHERE purpose='reset'").fetchone()[0], 1)

    def test_failed_email_is_reported_and_cannot_authenticate(self):
        failed, code = self.issue_otp(delivered=False)
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(self.verify_otp(code).status_code, 400)
        with database.get_db_connection() as conn:
            row = conn.execute("SELECT delivery_status,is_used FROM email_otps").fetchone()
            self.assertEqual((row[0], row[1]), ("failed", 1))
        self.assertEqual(self.issue_otp()[0].status_code, 429)

    def test_send_budget_shared_by_login_reset_and_used_codes(self):
        for i in range(settings.OTP_MAX_SENDS_PER_HOUR):
            response, _ = self.issue_otp("login" if i % 2 == 0 else "reset")
            self.assertEqual(response.status_code, 200)
            with database.get_db_connection() as conn:
                conn.execute("UPDATE email_otps SET requested_at = requested_at - 31, is_used = 1")
        self.assertEqual(self.issue_otp()[0].status_code, 429)

    def test_pending_email_cannot_authenticate_and_delivery_is_awaited(self):
        from app.services import user_service as service_module

        async def delivery(**kwargs):
            from fastapi import HTTPException
            with self.assertRaises(HTTPException):
                user_service.verify_login_otp("alice", kwargs["otp_code"])
            return True

        with patch.object(service_module.email_service, "send_otp_email", delivery):
            result = self.request("POST", "/user/otp/send", json={"email_or_username": "alice"})
        self.assertEqual(result.status_code, 200)

    def test_concurrent_otp_use_has_one_winner(self):
        _, code = self.issue_otp()
        from fastapi import HTTPException

        def verify(_):
            try:
                user_service.verify_login_otp("alice", code)
                return 200
            except HTTPException as exc:
                return exc.status_code

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(verify, range(4)))
        self.assertEqual(sorted(results), [200, 400, 400, 400])

    def test_concurrent_wrong_guesses_do_not_lose_attempts(self):
        self.issue_otp()
        from fastapi import HTTPException

        def verify(_):
            try:
                user_service.verify_login_otp("alice", "000000")
                return 200
            except HTTPException as exc:
                return exc.status_code

        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(verify, range(6))), [400] * 6)
        with database.get_db_connection() as conn:
            row = conn.execute("SELECT attempts,is_used FROM email_otps").fetchone()
            self.assertEqual((row[0], row[1]), (3, 1))

    def test_password_update_failure_rolls_back_otp_consumption(self):
        _, code = self.issue_otp("reset")
        with database.get_db_connection() as conn:
            original = conn.execute("SELECT password_hash FROM users WHERE id=?", (self.alice.id,)).fetchone()[0]
            conn.execute("CREATE TRIGGER reject_password BEFORE UPDATE OF password_hash ON users "
                         "BEGIN SELECT RAISE(ABORT, 'fixture update failure'); END")
        with self.assertRaises(Exception):
            self.verify_otp(code, "reset")
        with database.get_db_connection() as conn:
            self.assertEqual(conn.execute("SELECT is_used FROM email_otps").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT password_hash FROM users WHERE id=?", (self.alice.id,)).fetchone()[0], original)
            conn.execute("DROP TRIGGER reject_password")
        self.assertEqual(self.verify_otp(code, "reset").status_code, 200)

    def test_multi_statement_failure_rolls_back_inserts(self):
        with self.assertRaises(Exception):
            with database.get_db_connection() as conn:
                conn.execute("INSERT INTO email_otps(id,email,otp_code,expires_at,created_at) "
                             "VALUES('rollback-fixture','fixture@example.invalid','unused',0,'fixture')")
                conn.execute("INSERT INTO email_otps(id,email,otp_code,expires_at,created_at) "
                             "VALUES('broken-fixture',NULL,'unused',0,'fixture')")
        with database.get_db_connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM email_otps").fetchone()[0], 0)

    def test_legacy_otp_migration_revokes_codes_and_is_repeatable(self):
        with database.get_db_connection() as conn:
            conn.execute("DROP INDEX idx_otp_email_requested")
            for name in ("purpose", "delivery_status", "requested_at"):
                conn.execute(f"ALTER TABLE email_otps DROP COLUMN {name}")
            conn.execute("INSERT INTO email_otps(id,email,otp_code,expires_at,created_at) "
                         "VALUES('legacy-fixture',?,'123456',?,'fixture')", (self.alice.email, time.time() + 300))
        database.init_db()
        database.init_db()
        self.assertEqual(self.verify_otp("123456").status_code, 400)
        with database.get_db_connection() as conn:
            row = conn.execute("SELECT is_used,otp_code FROM email_otps").fetchone()
            self.assertEqual((row[0], row[1]), (1, ""))


    def test_resend_replaces_only_its_own_purpose(self):
        self.issue_otp()
        with database.get_db_connection() as conn:
            conn.execute("UPDATE email_otps SET requested_at = requested_at - 31")
        self.issue_otp("reset")
        with database.get_db_connection() as conn:
            conn.execute("UPDATE email_otps SET requested_at = requested_at - 31")
        _, latest_code = self.issue_otp()
        with database.get_db_connection() as conn:
            rows = conn.execute("SELECT purpose,is_used FROM email_otps ORDER BY requested_at").fetchall()
            self.assertEqual([(row[0], row[1]) for row in rows], [("login", 1), ("reset", 0), ("login", 0)])
        self.assertEqual(self.verify_otp(latest_code).status_code, 200)

    def test_delivery_exception_is_redacted_and_challenge_revoked(self):
        from app.services import user_service as service_module
        sender = AsyncMock(side_effect=RuntimeError("sensitive fixture provider response"))
        with patch.object(service_module.email_service, "send_otp_email", sender), patch.object(service_module.logger, "error") as log:
            result = self.request("POST", "/user/otp/send", json={"email_or_username": "alice"})
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("sensitive fixture", str(log.call_args))
        with database.get_db_connection() as conn:
            self.assertEqual(conn.execute("SELECT delivery_status FROM email_otps").fetchone()[0], "failed")



class CloudAdapterSecurityTests(SecurityTests):
    """Exercise the Turso adapter with real SDK transactions on disposable SQL.

    This verifies statement/row compatibility, not remote Turso or its FK setup.
    """
    def setUp(self):
        super().setUp()
        import libsql_client
        original = libsql_client.create_client_sync
        # Run the installed SDK and its transaction/row classes against
        # disposable local SQL, without contacting a remote server.
        def client(**kwargs):
            return original(url=database.DB_FILE.resolve().as_uri())

        for replacement in (patch.object(database, "is_turso_configured", return_value=True),
                            patch.object(database, "get_turso_url", return_value="wss://fixture.invalid"),
                            patch.object(libsql_client, "create_client_sync", side_effect=client)):
            replacement.start()
            self.addCleanup(replacement.stop)

    def test_cloud_initializer_is_repeatable(self):
        database.init_db()
        self.assertEqual(self.request("GET", "/user/me", self.token).status_code, 200)


class EmailDeliveryTests(unittest.TestCase):
    def setUp(self):
        module_path = Path(__file__).resolve().parents[1] / "app/services/email_service.py"
        self.namespace = runpy.run_path(str(module_path))
        self.mail = self.namespace["EmailService"]()

    def test_unconfigured_smtp_fails_without_logging_email_content(self):
        with patch.object(settings, "SMTP_HOST", "", create=True), patch.object(logger, "warning") as log:
            self.assertFalse(self.mail._send_smtp_sync("fixture@example.invalid", "secret subject", "secret body", "secret html"))
        self.assertNotIn("secret", str(log.call_args))

    def test_provider_error_body_is_not_logged(self):
        import urllib.error
        with patch.multiple(settings, BREVO_API_KEY="fixture", BREVO_FROM_EMAIL="fixture@example.invalid",
                            BREVO_FROM_NAME="Fixture", create=True), patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError(
                                "https://fixture.invalid", 400, "fixture", Message(), io.BytesIO(b"secret provider response"))), patch.object(logger, "error") as log:
            self.assertFalse(self.mail._send_brevo_http("fixture@example.invalid", "secret", "secret", "secret"))
        self.assertNotIn("secret", str(log.call_args))

    def test_turso_transport_supports_transactions(self):
        for source, expected in (("libsql://fixture.invalid", "libsql://fixture.invalid"),
                                 ("https://fixture.invalid", "wss://fixture.invalid"),
                                 ("http://localhost:8080", "ws://localhost:8080")):
            with patch.object(settings, "TURSO_DATABASE_URL", source):
                self.assertEqual(database.get_turso_url(), expected)



class GoogleVerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from google.auth.crypt import RSASigner
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        cls.signer = RSASigner.from_string(private, key_id="fixture-key")
        cls.public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def token(self, **updates):
        from google.auth import jwt
        claims = {"iss": "https://accounts.google.com", "aud": "fixture-client", "sub": "fixture-subject",
                  "email": "fixture@gmail.com", "email_verified": True, "iat": int(time.time()), "exp": int(time.time()) + 3600}
        claims.update(updates)
        return jwt.encode(self.signer, claims).decode()

    def test_real_google_library_validates_signed_claims(self):
        from fastapi import HTTPException
        response = types.SimpleNamespace(status=200, data=json.dumps({"fixture-key": self.public}).encode())
        with patch.object(google_auth, "Request", return_value=lambda *args, **kwargs: response):
            self.assertEqual(google_auth.verify_google_credential(self.token())["sub"], "fixture-subject")
            for updates in ({"aud": "wrong"}, {"iss": "attacker.invalid"}, {"exp": 1},
                            {"email_verified": False}, {"sub": ""}, {"email": ""}):
                with self.subTest(updates=updates), self.assertRaises(HTTPException):
                    google_auth.verify_google_credential(self.token(**updates))
            with self.assertRaises(HTTPException):
                google_auth.verify_google_credential(self.token()[:-10] + "forged")
            self.assertEqual(google_auth.verify_google_credential(self.token(nonce="challenge"), "challenge")["nonce"], "challenge")
            with self.assertRaises(HTTPException):
                google_auth.verify_google_credential(self.token(nonce="different"), "challenge")


if __name__ == "__main__":
    try:
        unittest.main()
    finally:
        outbound.stop()
        fixture.cleanup()
