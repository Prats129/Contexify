"""Focused auth regressions with disposable SQL/files and mocked providers.

Run with backend/venv/Scripts/python.exe -B backend/tests/test_auth_security.py.
No application .env, production database, mail or AI provider is used.
"""

import asyncio
import base64
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
from contextlib import contextmanager
from datetime import datetime, timezone
from email.message import Message
from email.parser import BytesParser
from email.policy import default as email_policy
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
    DATA_DIR=root,
    MEDIA_DIR=root / "media",
    UPLOAD_IMAGE_DIR=root / "media/uploads",
    GENERATED_IMAGE_DIR=root / "media/generated",
    UPLOAD_DIR=root / "uploads",
    DATABASE_TYPE="sqlite",
    DB_MODE="local",
    TURSO_DATABASE_URL="",
    TURSO_AUTH_TOKEN="",
    GOOGLE_CLIENT_ID="fixture-client",
    AUTH_SESSION_TTL_SECONDS=3600,
    GUEST_SESSION_TTL_SECONDS=600,
    DOWNLOAD_TICKET_TTL_SECONDS=300,
    ADMIN_USER_IDS=[],
    TEMPORARY_CHAT_RETENTION_DAYS=3,
    OTP_MAX_ATTEMPTS=3,
    OTP_EXPIRY_SECONDS=180,
    OTP_RESEND_COOLDOWN_SECONDS=30,
    OTP_MAX_SENDS_PER_HOUR=5,
    is_cloudflare_r2_configured=False,
    CLOUDFLARE_R2_PUBLIC_URL="",
    CLOUDFLARE_R2_BUCKET_NAME="fixture",
    r2_endpoint_url="",
    API_V1_STR="/api/v1",
    PROJECT_NAME="Offline auth tests",
    CORS_ORIGINS=[],
    WORKSPACE_DIR=root,
    PDF_MAX_FILE_SIZE_BYTES=25 * 1024 * 1024,
    PDF_MAX_PAGES=1000,
    PDF_MAX_TEXT_CHARS=2_000_000,
    PDF_PARSE_TIMEOUT_SECONDS=30,
    PDF_PARSE_MEMORY_MB=256,
    PDF_MAX_CONCURRENT_PARSERS=2,
    CHROMA_PERSIST_DIR=root / "chroma_db",
    GEMINI_API_KEY="",
    DEFAULT_EMBEDDING_MODEL="fixture-embedding",
    EMBEDDING_DIMENSION=2,
    TOP_K_RETRIEVAL=4,
    SIMILARITY_THRESHOLD=0.2,
    CLOUDFLARE_AI_ACCOUNT_ID="",
    CLOUDFLARE_AI_API_TOKEN="",
    IMAGE_GENERATION_TIMEOUT_SECONDS=120,
    IMAGE_GENERATION_MAX_ATTEMPTS=3,
)
for directory in (
    settings.UPLOAD_DIR,
    settings.MEDIA_DIR,
    settings.UPLOAD_IMAGE_DIR,
    settings.GENERATED_IMAGE_DIR,
):
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
module("app.services.image_gen_service", image_gen_service=Mock(aclose=AsyncMock()))


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
outbound = patch(
    "requests.sessions.Session.request",
    side_effect=AssertionError("Unexpected network request"),
)
outbound.start()
import httpx

from app.core import security
from app.db import database
from app.main import app
from app.schemas.user import UserRegisterRequest
from app.services import google_auth
from app.services.user_service import hash_password, user_service


class SecurityTests(unittest.TestCase):
    def reply_orchestrator(self, fail=False):
        """Real routing/persistence with providers replaced by deterministic fixtures."""
        from app.services.media_service import media_service

        async def answer(*args, **kwargs):
            yield "Fixture "
            if fail:
                raise RuntimeError("fixture interrupted provider")
            yield "answer"

        async def generate(*args, **kwargs):
            if fail:
                raise RuntimeError("fixture generation failure")
            return media_service.save_generated_image(
                self.image_fixture(), "Fixture image", session_id=kwargs["session_id"]
            )

        providers = {}
        for name in (
            "llm_service",
            "image_gen_service",
            "web_search_service",
            "rag_service",
        ):
            stub = types.ModuleType("app.services." + name)
            service = Mock()
            setattr(stub, name, service)
            providers[stub.__name__] = stub
        llm = providers["app.services.llm_service"].llm_service
        for name in (
            "stream_conversational_answer",
            "stream_rag_answer",
            "stream_web_search_answer",
            "stream_multimodal_answer",
        ):
            setattr(llm, name, answer)
        providers[
            "app.services.image_gen_service"
        ].image_gen_service.generate_image = generate
        providers[
            "app.services.web_search_service"
        ].web_search_service.search.return_value = [
            {
                "title": "Fixture source",
                "url": "https://example.invalid/fixture",
                "snippet": "Fixture evidence",
            }
        ]
        providers[
            "app.services.rag_service"
        ].rag_service.retrieve_context_for_query.return_value = [
            {
                "text": "Fixture document",
                "metadata": {
                    "document_id": "document",
                    "filename": "fixture.txt",
                    "chunk_index": 0,
                },
            }
        ]
        with patch.dict(sys.modules, providers):
            return runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"
                )
            )["chat_orchestrator"]

    def test_history_windows_have_stable_cursors_and_preserve_all_rows(self):
        from app.services.chat_history_service import chat_history_service as history

        for index in range(125):
            history.save_message("alice-session", "user", f"Message {index}")
        # Explicit ties exercise deterministic ordering in SQLite and Turso.
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE messages SET created_at='2026-01-01T00:00:00' WHERE session_id='alice-session'"
            )
        all_ids = [m.id for m in history.get_session_messages("alice-session")]

        def page(**params):
            response = self.request(
                "GET", "/session/alice-session/history", self.token, params=params
            )
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        latest = page()
        self.assertEqual([m["id"] for m in latest["messages"]], all_ids[-50:])
        self.assertTrue(latest["has_older"])
        self.assertFalse(latest["has_newer"])
        middle = page(before=latest["messages"][0]["id"])
        oldest = page(before=middle["messages"][0]["id"])
        self.assertEqual(
            [
                m["id"]
                for m in oldest["messages"] + middle["messages"] + latest["messages"]
            ],
            all_ids,
        )
        self.assertFalse(oldest["has_older"])
        self.assertTrue(oldest["has_newer"])
        newer = page(after=middle["messages"][-1]["id"])
        self.assertEqual([m["id"] for m in newer["messages"]], all_ids[-50:])
        target = page(through=all_ids[12], limit=10)
        self.assertEqual([m["id"] for m in target["messages"]], all_ids[3:13])
        history.save_message("alice-session", "assistant", "Concurrent newest answer")
        stable = page(before=latest["messages"][0]["id"])
        self.assertEqual(stable["messages"], middle["messages"])
        security.ensure_session(
            "bob-session", security.resolve_principal(security.digest(self.other_token))
        )
        foreign = history.save_message("bob-session", "user", "Private")
        self.assertEqual(
            self.request(
                "GET",
                "/session/alice-session/history",
                self.token,
                params={"before": foreign.id},
            ).status_code,
            404,
        )
        self.assertEqual(
            self.request(
                "GET",
                "/session/alice-session/history",
                self.token,
                params={"before": all_ids[20], "after": all_ids[30]},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.request(
                "GET",
                "/session/alice-session/history",
                self.token,
                params={"limit": 101},
            ).status_code,
            422,
        )
        self.assertEqual(len(history.get_session_messages("alice-session")), 126)
        self.request("DELETE", "/session/alice-session/messages", self.token)
        self.assertEqual(
            self.request(
                "GET",
                "/session/alice-session/history",
                self.token,
                params={"before": all_ids[0]},
            ).status_code,
            404,
        )

    def test_saved_title_survives_history_windows_reload_and_new_turns(self):
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service as history

        actual = self.reply_orchestrator()

        def send(message):
            async def consume():
                async for _ in actual.route_and_stream(
                    ChatRequest(session_id="alice-session", message=message),
                    self.principal,
                ):
                    pass

            asyncio.run(consume())

        send("Original conversation question")
        expected = "Original conversation question"
        for index in range(110):
            history.save_message("alice-session", "user", f"Later question {index}")
        ids = [m.id for m in history.get_session_messages("alice-session")]
        for params in ({}, {"before": ids[62]}, {"around": ids[20]}):
            response = self.request(
                "GET", "/session/alice-session/history", self.token, params=params
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["session"]["title"], expected)
        send("Newest question after pagination")
        stored_session = history.get_session("alice-session")
        assert stored_session is not None
        self.assertEqual(stored_session.title, expected)
        history.update_session_title("alice-session", "My custom title")
        # Simulate an auto-title write that was queued before the manual rename.
        self.assertFalse(
            history.update_session_title(
                "alice-session", "Stale automatic title", only_if_default=True
            )
        )
        send("Another latest question")
        response = self.request("GET", "/session/alice-session/history", self.token)
        self.assertEqual(response.json()["session"]["title"], "My custom title")
        sessions = self.request(
            "GET",
            "/session/list",
            self.token,
            params={"user_id": self.alice.id, "paginate": True},
        )
        self.assertEqual(sessions.status_code, 200, sessions.text)
        saved = next(
            s for s in sessions.json()["sessions"] if s["id"] == "alice-session"
        )
        self.assertEqual(saved["title"], "My custom title")

    def test_centered_reply_history_has_neighbors_and_safe_cursors(self):
        from app.services.chat_history_service import chat_history_service as history

        for index in range(31):
            history.save_message("alice-session", "user", f"Message {index}")
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE messages SET created_at='2026-01-01T00:00:00' WHERE session_id='alice-session'"
            )
        ids = [m.id for m in history.get_session_messages("alice-session")]

        def request(**params):
            return self.request(
                "GET", "/session/alice-session/history", self.token, params=params
            )

        for index in (0, 2, 15, 28, 30):
            with self.subTest(index=index):
                response = request(around=ids[index])
                self.assertEqual(response.status_code, 200, response.text)
                body = response.json()
                start, end = max(0, index - 5), min(len(ids), index + 6)
                self.assertEqual([m["id"] for m in body["messages"]], ids[start:end])
                self.assertEqual(body["has_older"], start > 0)
                self.assertEqual(body["has_newer"], end < len(ids))
        self.assertEqual(
            [m["id"] for m in request(before=ids[10]).json()["messages"]], ids[:10]
        )
        self.assertEqual(
            [m["id"] for m in request(after=ids[20]).json()["messages"]], ids[21:]
        )
        for cursor in ("before", "after", "through"):
            self.assertEqual(
                request(around=ids[15], **{cursor: ids[1]}).status_code, 400
            )
        self.assertEqual(request(around="missing").status_code, 404)
        self.assertEqual(request(around="").status_code, 422)
        security.ensure_session(
            "bob-session", security.resolve_principal(security.digest(self.other_token))
        )
        foreign = history.save_message("bob-session", "user", "Private")
        self.assertEqual(request(around=foreign.id).status_code, 404)
        self.assertEqual(
            self.request(
                "GET",
                "/session/alice-session/history",
                self.other_token,
                params={"around": ids[15]},
            ).status_code,
            404,
        )
        self.request("DELETE", "/session/alice-session/messages", self.token)
        self.assertEqual(request(around=ids[15]).status_code, 404)
        only = history.save_message("alice-session", "user", "Only message")
        body = request(around=only.id).json()
        self.assertEqual([m["id"] for m in body["messages"]], [only.id])
        self.assertFalse(body["has_older"])
        self.assertFalse(body["has_newer"])

    def test_model_history_is_bounded_and_old_replies_load_their_own_window(self):
        from app.repositories.session_store import session_store_repo
        from app.services.chat_history_service import chat_history_service as history

        messages = [
            history.save_message("alice-session", "user", f"Turn {i}")
            for i in range(65)
        ]
        latest = session_store_repo.get_history_messages("alice-session")
        self.assertEqual([m["id"] for m in latest], [m.id for m in messages[-40:]])
        older = session_store_repo.get_history_messages(
            "alice-session", reply_to_id=messages[10].id
        )
        self.assertEqual([m["id"] for m in older], [m.id for m in messages[:11]])
        security.ensure_session(
            "bob-session", security.resolve_principal(security.digest(self.other_token))
        )
        foreign = history.save_message("bob-session", "user", "Private")
        self.assertEqual(
            session_store_repo.get_history_messages(
                "alice-session", reply_to_id=foreign.id
            ),
            [],
        )
        self.assertEqual(len(history.get_session_messages("alice-session")), 65)
        large = history.save_message("alice-session", "assistant", "x" * 20_000)
        self.assertEqual(
            len(
                session_store_repo.get_history_messages("alice-session")[-1]["content"]
            ),
            8_000,
        )
        self.assertEqual(
            len(history.get_session_messages("alice-session")[-1].content), 20_000
        )
        self.assertEqual(history.get_session_messages("alice-session")[-1].id, large.id)

    def test_cache_limits_and_ttl_reconstruct_guest_history_without_data_loss(self):
        from app.repositories.session_store import SessionStoreRepository
        from app.services.chat_history_service import chat_history_service as history

        repository = SessionStoreRepository()
        guest = security.create_guest()
        principal = security.resolve_principal(security.digest(guest["access_token"]))
        security.ensure_session("bounded-guest", principal)
        saved = history.save_message("bounded-guest", "user", "Retained guest message")
        with (
            patch.object(settings, "SESSION_CACHE_MAX_ENTRIES", 1, create=True),
            patch.object(settings, "DOCUMENT_CACHE_MAX_ENTRIES", 1, create=True),
        ):
            repository.get_or_create_session("bounded-guest")
            repository.get_or_create_session("alice-session")
            self.assertEqual(len(repository._sessions), 1)
            self.assertNotIn("bounded-guest", repository._sessions)
            self.assertEqual(
                repository.get_history_messages("bounded-guest")[0]["id"], saved.id
            )
            for _ in range(50):
                repository.record_message("alice-session", "user", "Cached only")
            self.assertEqual(len(repository._sessions["alice-session"].messages), 40)
            self.assertLessEqual(len(repository._documents), 1)
        with patch.object(settings, "SESSION_CACHE_TTL_SECONDS", 1, create=True):
            namespace = repository._trim_cache.__func__.__globals__
            with patch.dict(namespace, {"monotonic": lambda: time.monotonic() + 100}):
                repository._trim_cache()
            self.assertEqual(repository._sessions, {})
        self.assertEqual(
            history.get_session_messages("bounded-guest")[0].content,
            "Retained guest message",
        )
        response = self.request(
            "GET", "/session/bounded-guest/history", guest["access_token"]
        )
        self.assertEqual(response.json()["messages"][0]["id"], saved.id)
        self.assertEqual(
            self.request(
                "GET", "/session/bounded-guest/history", self.other_token
            ).status_code,
            404,
        )
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE chat_sessions SET expires_at='2000-01-01' WHERE id='bounded-guest'"
            )
        history.purge_expired_temporary_sessions()
        self.assertEqual(history.get_session_messages("bounded-guest"), [])

    def test_embedding_batches_are_bounded_and_failed_batches_return_no_partial_vectors(
        self,
    ):
        from app.core.errors import EmbeddingError

        with patch.dict("os.environ", {"GEMINI_API_KEY": ""}):
            namespace = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1]
                    / "app/services/embedding_service.py"
                )
            )
        service = namespace["embedding_service"]
        calls = []

        def embed(**kwargs):
            contents = kwargs["contents"]
            calls.append(len(contents))
            return types.SimpleNamespace(
                embeddings=[types.SimpleNamespace(values=[1.0, 0.0]) for _ in contents]
            )

        service.client = types.SimpleNamespace(
            models=types.SimpleNamespace(embed_content=embed)
        )
        self.assertEqual(len(service.embed_batch(["fixture"] * 230)), 230)
        self.assertEqual(calls, [100, 100, 30])
        calls.clear()

        def fail(**kwargs):
            if calls:
                raise RuntimeError("private fixture error")
            return embed(**kwargs)

        service.client.models.embed_content = fail
        with self.assertRaises(EmbeddingError) as caught:
            service.embed_batch(["fixture"] * 230)
        self.assertNotIn("private fixture", str(caught.exception))
        self.assertEqual(calls, [100])

    def test_document_resource_limits_fail_without_storing_or_embedding(self):
        from app.api.v1.endpoints import document

        self.assertTrue(document._upload_slots.acquire(blocking=False))
        self.assertTrue(document._upload_slots.acquire(blocking=False))
        try:
            busy = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("busy.txt", b"test", "text/plain")},
            )
            self.assertEqual(busy.status_code, 503)
        finally:
            document._upload_slots.release()
            document._upload_slots.release()
        rag, _, embedder = self._load_document_pipeline()
        with (
            self._isolated_r2() as (objects, storage_client),
            patch.object(document, "rag_service", rag),
        ):
            original = dict(objects)
            with patch.object(settings, "DOCUMENT_MAX_FILE_SIZE_BYTES", 8, create=True):
                result = self.request(
                    "POST",
                    "/document/upload",
                    self.token,
                    data={"session_id": "alice-session"},
                    files={"file": ("large.txt", b"123456789", "text/plain")},
                )
                self.assertEqual(result.status_code, 413, result.text)
            with patch.object(settings, "DOCUMENT_MAX_TEXT_CHARS", 3, create=True):
                result = self.request(
                    "POST",
                    "/document/upload",
                    self.token,
                    data={"session_id": "alice-session"},
                    files={"file": ("text.txt", b"test", "text/plain")},
                )
                self.assertEqual(result.status_code, 413, result.text)
            with patch.object(settings, "DOCUMENT_MAX_CHUNKS", 1, create=True):
                result = self.request(
                    "POST",
                    "/document/upload",
                    self.token,
                    data={"session_id": "alice-session"},
                    files={"file": ("chunks.txt", b"word " * 1000, "text/plain")},
                )
                self.assertEqual(result.status_code, 413, result.text)
            self.assertEqual(objects, original)
            embedder.embed_batch.assert_not_called()
            result = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("small.txt", b"test", "text/plain")},
            )
            self.assertEqual(result.status_code, 201, result.text)
            embedder.embed_batch.assert_called_once()

    def test_web_search_failure_and_empty_results_never_generate_or_cite(self):
        from app.api.v1.endpoints import chat
        from app.core.errors import WebSearchError
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        services = actual._route_and_stream.__func__.__globals__
        search = services["web_search_service"].search
        llm = Mock(side_effect=AssertionError("No generation without evidence"))
        for unavailable in (True, False):
            with self.subTest(unavailable=unavailable):
                search.side_effect = WebSearchError() if unavailable else None
                search.return_value = []
                with (
                    patch.object(chat, "chat_orchestrator", actual),
                    patch.object(
                        services["llm_service"], "stream_web_search_answer", llm
                    ),
                ):
                    response = self.request(
                        "POST",
                        "/chat/stream",
                        self.token,
                        json={
                            "session_id": "alice-session",
                            "mode": "WEB_SEARCH",
                            "message": "Search weather today",
                        },
                    )
                events = [
                    json.loads(frame[6:])
                    for frame in response.text.strip().split("\n\n")
                ]
                self.assertEqual(events[-1]["event"], "done")
                self.assertFalse(any(e["event"] == "citations" for e in events))
                text = "".join(e["data"] for e in events if e["event"] == "token")
                self.assertIn("could not verify", text)
                if unavailable:
                    self.assertIn("temporarily unavailable", text)
                else:
                    self.assertIn("more specific", text)
                saved = chat_history_service.get_session_messages("alice-session")[-1]
                self.assertEqual(saved.content, text)
                self.assertFalse(saved.citations)
        llm.assert_not_called()

    def test_web_search_citations_label_excerpts_and_persist_real_links(self):
        from app.api.v1.endpoints import chat
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        with patch.object(chat, "chat_orchestrator", actual):
            response = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={
                    "session_id": "alice-session",
                    "mode": "WEB_SEARCH",
                    "message": "Search weather today",
                },
            )
        events = [
            json.loads(frame[6:]) for frame in response.text.strip().split("\n\n")
        ]
        self.assertEqual(events[-1]["event"], "done")
        citations = next(e["citations"] for e in events if e["event"] == "citations")
        self.assertEqual(len(citations), 1)
        self.assertTrue(
            citations[0]["snippet"].startswith("https://example.invalid/fixture\n")
        )
        self.assertIn("full page not retrieved", citations[0]["snippet"])
        self.assertEqual(citations[0]["document_id"], "")
        saved = chat_history_service.get_session_messages("alice-session")[-1]
        assert saved.citations is not None
        self.assertEqual(saved.citations[0].model_dump(), citations[0])

    def test_routing_matrix_respects_modes_sources_and_safe_image_intent(self):
        from app.schemas.chat import ChatMode, ChatRequest

        actual = self.reply_orchestrator()
        doc = [{"id": "document", "file_type": "document"}]
        image = [{"id": "image", "file_type": "image"}]
        doc_history = [
            {
                "id": "doc-answer",
                "role": "assistant",
                "content": "Document answer",
                "citations": [{"document_id": "document"}],
            }
        ]
        web_history = [
            {
                "id": "web-answer",
                "role": "assistant",
                "content": "Web answer",
                "citations": [{"document_id": ""}],
            }
        ]
        image_history = [
            {
                "id": "image-message",
                "role": "user",
                "content": "Describe this image",
                "attachments": image,
            },
            {"role": "assistant", "content": "A tree"},
        ]
        general_history = image_history + [
            {"role": "user", "content": "Create a Python function"},
            {"role": "assistant", "content": "Here is code"},
        ]
        cases = [
            ("DOCUMENT_RAG", "Summarize the document", [], [], "DOCUMENT_RAG"),
            ("DOCUMENT_RAG", "Why?", [], doc_history, "DOCUMENT_RAG"),
            ("DOCUMENT_RAG", "Generate an image of a tree", [], [], "DOCUMENT_RAG"),
            ("DOCUMENT_RAG", "Latest weather today", [], [], "DOCUMENT_RAG"),
            ("DOCUMENT_RAG", "Hi", [], [], "AUTO"),
            ("DOCUMENT_RAG", "Hi, summarize the report", [], [], "DOCUMENT_RAG"),
            ("WEB_SEARCH", "Summarize this document", doc, [], "WEB_SEARCH"),
            ("WEB_SEARCH", "Create a Python function", [], [], "WEB_SEARCH"),
            ("WEB_SEARCH", "Thanks", [], web_history, "AUTO"),
            ("IMAGE_GENERATION", "A mountain at sunrise", [], [], "IMAGE_GENERATION"),
            ("IMAGE_GENERATION", "Hello", [], [], "AUTO"),
            ("IMAGE_GENERATION", "Help me", [], [], "AUTO"),
            ("IMAGE_GENERATION", "Do not generate an image", [], [], "AUTO"),
            ("IMAGE_GENERATION", "Explain more", [], image_history, "MULTIMODAL"),
            ("MULTIMODAL", "Summarize", doc, [], "DOCUMENT_RAG"),
            ("MULTIMODAL", "Compare both", doc + image, [], "DOCUMENT_RAG"),
            ("AUTO", "Hi", [], image_history, "AUTO"),
            ("AUTO", "Hi, summarize this file", doc, [], "DOCUMENT_RAG"),
            ("AUTO", "Summarize", [], [], "DOCUMENT_RAG"),
            ("AUTO", "Why?", [], doc_history, "DOCUMENT_RAG"),
            ("AUTO", "What is this?", [], doc_history, "DOCUMENT_RAG"),
            ("AUTO", "Tell me more", [], web_history, "WEB_SEARCH"),
            ("AUTO", "Tell me more", [], image_history, "MULTIMODAL"),
            ("AUTO", "Tell me more", [], general_history, "AUTO"),
            ("AUTO", "What is this?", [], general_history, "AUTO"),
            ("AUTO", "Make it brighter", [], image_history, "IMAGE_GENERATION"),
            ("AUTO", "Remove the background", [], image_history, "IMAGE_GENERATION"),
            ("AUTO", "Describe the earlier image", [], general_history, "MULTIMODAL"),
            ("AUTO", "Can you create a Python function?", [], image_history, "AUTO"),
            ("AUTO", "Create a function to read the file", [], [], "AUTO"),
            (
                "AUTO",
                "Create a function based on this document",
                [],
                [],
                "DOCUMENT_RAG",
            ),
            ("AUTO", "Draw a graph using Python", [], [], "AUTO"),
            ("AUTO", "Create an SVG image of a cat", [], [], "AUTO"),
            ("AUTO", "Latest news today", [], doc_history, "WEB_SEARCH"),
            ("AUTO", "Latest news according to this document", [], [], "DOCUMENT_RAG"),
            ("AUTO", "Latest news", doc, [], "DOCUMENT_RAG"),
            ("AUTO", "Read this image", image, [], "MULTIMODAL"),
            (
                "AUTO",
                "Compare the image and this file",
                doc + image,
                [],
                "DOCUMENT_RAG",
            ),
            (
                "AUTO",
                "Generate an image of a mountain",
                [],
                doc_history,
                "IMAGE_GENERATION",
            ),
        ]
        for mode, query, attachments, history, expected in cases:
            with self.subTest(mode=mode, query=query, expected=expected):
                request = ChatRequest(
                    session_id="alice-session",
                    mode=mode,
                    message=query,
                    attachments=attachments,
                )
                route, scope = actual.routing.choose_route(
                    request, ChatMode(mode), ["document"], history
                )
                self.assertEqual(route.value, expected)
                if (
                    attachments
                    and any(a["file_type"] == "document" for a in attachments)
                    and expected == "DOCUMENT_RAG"
                ):
                    self.assertEqual(scope, ["document"])
        for query in (
            "Generate an image of a cat",
            "Could you please make me a photo of a lake",
            "Draw a tree",
            "Sketch a house",
            "/image a cat",
            "/imagine a tree",
            "image: a city",
            "Edit this picture",
            "Turn this picture into watercolor",
            "Design an infographic",
            "Create 3 pictures",
            "Create an image of a Python function",
        ):
            with self.subTest(image_query=query):
                self.assertTrue(actual.routing.is_image_gen_intent(query))
        for query in (
            "Can you create a Python function?",
            "Could you create a SQL query?",
            "Draw a conclusion",
            "Draw parallels between these ideas",
            "Draw up a plan",
            "Sketch out a plan",
            "Illustrate an algorithm",
            "Generate a CSV file",
            "Explain how to generate an image",
            "Do not generate an image",
            "Don't draw a cat",
            "/imagesomething",
            "Generate an SVG image",
            "Create an image using Python",
            "Create an image classifier",
            "Tell a story about an artist who draws pictures",
        ):
            with self.subTest(non_image_query=query):
                self.assertFalse(actual.routing.is_image_gen_intent(query))
        for query in (
            "stockpile inventory",
            "research methods",
            "What does this score function do?",
            "What happened in 2025?",
        ):
            self.assertFalse(actual.routing.needs_web_search(query), query)

    def test_routing_auto_documents_do_not_capture_new_topics_or_explicit_web_replies(
        self,
    ):
        from app.schemas.chat import ChatMode, ChatRequest

        actual = self.reply_orchestrator()
        history = [
            {"id": "question", "role": "user", "content": "Review this document"},
            {
                "id": "answer",
                "role": "assistant",
                "content": "Document summary",
                "citations": [{"document_id": "document"}],
            },
        ]
        cases = [
            ("What is quantum computing?", None, ChatMode.AUTO),
            ("Explain how a bicycle works", None, ChatMode.AUTO),
            (
                "Search the web for the latest Python release",
                "answer",
                ChatMode.WEB_SEARCH,
            ),
            ("Create a Python function to reverse a string", "answer", ChatMode.AUTO),
            ("Why?", "answer", ChatMode.DOCUMENT_RAG),
            ("Summarize this document", None, ChatMode.DOCUMENT_RAG),
        ]
        for query, reply_id, expected in cases:
            with self.subTest(query=query):
                request = ChatRequest(
                    message=query,
                    reply_to={
                        "id": reply_id,
                        "role": "assistant",
                        "content": "Document summary",
                    }
                    if reply_id
                    else None,
                )
                route, _ = actual.routing.choose_route(
                    request, ChatMode.AUTO, ["document"], history
                )
                self.assertEqual(route, expected)
        # A reply to an unrelated message must not inherit older document evidence.
        history += [{"id": "general", "role": "user", "content": "Explain gravity"}]
        route, _ = actual.routing.choose_route(
            ChatRequest(
                message="Why?",
                reply_to={
                    "id": "general",
                    "role": "user",
                    "content": "Explain gravity",
                },
            ),
            ChatMode.AUTO,
            ["document"],
            history,
        )
        self.assertEqual(route, ChatMode.AUTO)

    def test_routing_followups_use_saved_citations_and_explicit_reply_scope(self):
        from app.api.v1.endpoints import chat

        actual = self.reply_orchestrator()
        services = actual._route_and_stream.__func__.__globals__
        with patch.object(chat, "chat_orchestrator", actual):
            first = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={
                    "session_id": "alice-session",
                    "mode": "AUTO",
                    "message": "Summarize quantum entanglement from this file",
                    "attachments": [{"id": "document", "file_type": "document"}],
                },
            )
            self.assertIn('"event": "citations"', first.text)
            history = self.request(
                "GET", "/session/alice-session/history", self.token
            ).json()["messages"]
            document_answer = history[-1]["id"]
            for query in ("Why?", "Latest weather forecast", "Tell me more"):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "alice-session",
                        "mode": "AUTO",
                        "message": query,
                    },
                )
                events = [
                    json.loads(frame[6:])
                    for frame in response.text.strip().split("\n\n")
                ]
                self.assertEqual(events[-1]["event"], "done", response.text)
            self.assertIn(
                "Latest weather forecast",
                services["web_search_service"].search.call_args.args[0],
            )
            self.assertIn(
                "Summarize quantum entanglement",
                services["rag_service"].retrieve_context_for_query.call_args.args[0],
            )
            response = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={
                    "session_id": "alice-session",
                    "mode": "AUTO",
                    "message": "Explain more",
                    "reply_to": {
                        "id": document_answer,
                        "role": "assistant",
                        "content": "Document answer",
                    },
                },
            )
            self.assertIn('"event": "citations"', response.text)
            self.assertEqual(
                services["rag_service"].retrieve_context_for_query.call_args.kwargs[
                    "document_ids"
                ],
                ["document"],
            )
            self.assertEqual(
                len(
                    self.request(
                        "GET", "/session/alice-session/history", self.token
                    ).json()["messages"]
                ),
                10,
            )

    def test_routing_mixed_attachments_preserves_document_scope_and_images(self):
        from app.api.v1.endpoints import chat

        actual = self.reply_orchestrator()
        services = actual._route_and_stream.__func__.__globals__
        received = []

        async def grounded(query, context_chunks, chat_history=None, **kwargs):
            received.append((query, context_chunks, kwargs.get("attachments")))
            yield "Grounded comparison"

        with (
            patch.object(chat, "chat_orchestrator", actual),
            patch.object(services["llm_service"], "stream_rag_answer", grounded),
        ):
            response = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={
                    "session_id": "alice-session",
                    "message": "Compare the attached image and document",
                    "attachments": [
                        {"id": "document", "file_type": "document"},
                        {"id": "image", "file_type": "image"},
                    ],
                },
            )
            followup = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={
                    "session_id": "alice-session",
                    "message": "Explain more",
                    "mode": "AUTO",
                },
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(received), 2)
        self.assertIn('"event": "citations"', followup.text)
        self.assertEqual([a.id for a in received[1][2]], ["image"])
        self.assertEqual([a.id for a in received[0][2]], ["image"])
        self.assertEqual(received[0][1][0]["metadata"]["document_id"], "document")
        self.assertIn('"event": "citations"', response.text)
        history = self.request(
            "GET", "/session/alice-session/history", self.token
        ).json()["messages"]
        self.assertEqual(
            {a["id"] for a in history[0]["attachments"]}, {"image", "document"}
        )

    def test_routing_runtime_prevents_unwanted_image_and_stale_vision_calls(self):
        from app.api.v1.endpoints import chat
        from app.schemas.chat import MediaAttachment
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        services = actual._route_and_stream.__func__.__globals__
        chat_history_service.save_message(
            "alice-session",
            "user",
            "Describe this image",
            attachments=[MediaAttachment(id="image", file_type="image")],
        )
        chat_history_service.save_message("alice-session", "assistant", "A tree")
        forbidden = Mock(side_effect=AssertionError("Unrequested provider call"))
        with (
            patch.object(chat, "chat_orchestrator", actual),
            patch.object(actual, "_execute_image_generation", forbidden),
            patch.object(actual, "_execute_multimodal", forbidden),
            patch.object(actual, "_execute_web_search", forbidden),
        ):
            for query in (
                "Hello",
                "Can you create a Python function?",
                "Create a function to read the file",
                "Tell me more",
            ):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "alice-session",
                        "message": query,
                        "mode": "AUTO",
                    },
                )
                events = [
                    json.loads(frame[6:])
                    for frame in response.text.strip().split("\n\n")
                ]
                self.assertEqual(events[-1]["event"], "done", response.text)
                self.assertFalse(any(event["event"] == "citations" for event in events))
            forbidden.assert_not_called()
            services["rag_service"].retrieve_context_for_query.assert_not_called()
            for query in (
                "Summarize key points covered in the document",
                "Why?",
                "Hi, summarize the report",
            ):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "alice-session",
                        "message": query,
                        "mode": "DOCUMENT_RAG",
                    },
                )
                events = [
                    json.loads(frame[6:])
                    for frame in response.text.strip().split("\n\n")
                ]
                self.assertEqual(events[-1]["event"], "done", response.text)
                self.assertTrue(any(event["event"] == "citations" for event in events))
            forbidden.assert_not_called()

    def test_routing_image_followups_use_authorized_focus_without_resurrecting_old_images(
        self,
    ):
        from app.api.v1.endpoints import chat
        from app.schemas.chat import MediaAttachment
        from app.services.chat_history_service import chat_history_service
        from app.services.media_service import media_service

        actual = self.reply_orchestrator()
        services = actual._route_and_stream.__func__.__globals__
        edit = AsyncMock(
            return_value=MediaAttachment(
                id="image", url="media/uploads/fixture.png", file_type="image"
            )
        )
        vision = Mock(wraps=actual._execute_multimodal)
        with (
            patch.object(chat, "chat_orchestrator", actual),
            patch.object(actual, "_execute_multimodal", vision),
            patch.object(
                services["image_gen_service"], "generate_from_reference", edit
            ),
        ):

            def send(message, attachments=None):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "alice-session",
                        "mode": "AUTO",
                        "message": message,
                        "attachments": attachments or [],
                    },
                )
                events = [
                    json.loads(frame[6:])
                    for frame in response.text.strip().split("\n\n")
                ]
                self.assertEqual(events[-1]["event"], "done", response.text)
                return events

            send("Describe this image", [{"id": "image", "file_type": "image"}])
            send("Make it brighter")
            edit.assert_awaited_once()
            self.assertEqual(
                edit.call_args.kwargs["reference_image_path"],
                "media/uploads/fixture.png",
            )
            self.assertEqual(vision.call_count, 1)
            send("Create a Python function")
            send("Explain more")
            self.assertEqual(vision.call_count, 1)
            self.assertEqual(edit.await_count, 1)
            send("Describe the earlier image")
            self.assertEqual(vision.call_count, 2)
            generated = media_service.save_generated_image(
                self.image_fixture(), "fixture", session_id="alice-session"
            )
            chat_history_service.save_message(
                "alice-session", "assistant", "New image", attachments=[generated]
            )
            with database.get_db_connection() as conn:
                conn.execute("DELETE FROM media_assets WHERE id=?", (generated.id,))
            events = send("Tell me more")
            self.assertTrue(
                any("attach an image" in event.get("data", "") for event in events)
            )
            self.assertEqual(vision.call_count, 2)
            self.assertEqual(edit.await_count, 1)

    def test_routing_guest_memory_keeps_citations_for_followups(self):
        from app.repositories.session_store import session_store_repo
        from app.schemas.chat import ChatMode, ChatRequest

        guest = security.create_guest()
        principal = security.resolve_principal(security.digest(guest["access_token"]))
        security.ensure_session("routing-guest", principal)
        actual = self.reply_orchestrator()
        actual._persist_message("routing-guest", "user", "Explain quantum mechanics")
        actual._persist_message(
            "routing-guest",
            "assistant",
            "Document evidence",
            citations=[
                {
                    "document_id": "guest-document",
                    "filename": "guest.txt",
                    "chunk_index": 0,
                    "snippet": "Evidence",
                    "similarity_score": 1.0,
                }
            ],
        )
        history = session_store_repo.get_history_messages("routing-guest")
        self.assertEqual(history[-1]["citations"][0]["document_id"], "guest-document")
        route, scope = actual.routing.choose_route(
            ChatRequest(message="Why?"), ChatMode.AUTO, ["guest-document"], history
        )
        self.assertEqual(route, ChatMode.DOCUMENT_RAG)
        self.assertEqual(scope, ["guest-document"])

    def test_routing_deleted_document_followup_does_not_leak_into_web_search(self):
        from app.api.v1.endpoints import chat
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        services = actual._route_and_stream.__func__.__globals__
        with patch.object(chat, "chat_orchestrator", actual):
            response = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={
                    "session_id": "alice-session",
                    "message": "Summarize this document",
                    "attachments": [{"id": "document", "file_type": "document"}],
                },
            )
            self.assertIn('"event": "citations"', response.text)
            chat_history_service.delete_document("document")
            services["rag_service"].retrieve_context_for_query.reset_mock()
            response = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={"session_id": "alice-session", "message": "Why?", "mode": "AUTO"},
            )
        self.assertIn("no longer available", response.text)
        services["web_search_service"].search.assert_not_called()
        services["rag_service"].retrieve_context_for_query.assert_not_called()

    def test_slow_search_retrieval_and_auth_leave_other_requests_responsive(self):
        import threading

        from app.api.v1.endpoints import chat, user

        for operation in ("search", "retrieval", "authorization", "login"):
            with self.subTest(operation=operation):
                actual = self.reply_orchestrator()
                services = actual._route_and_stream.__func__.__globals__
                if operation == "search":
                    target, name = services["web_search_service"], "search"
                elif operation == "retrieval":
                    target, name = services["rag_service"], "retrieve_context_for_query"
                elif operation == "authorization":
                    target, name = chat, "ensure_session"
                else:
                    target, name = user.user_service, "authenticate_user"
                original = getattr(target, name)
                started, release = threading.Event(), threading.Event()
                worker_ids = []

                def slow(*args, **kwargs):
                    worker_ids.append(threading.get_ident())
                    started.set()
                    if not release.wait(5):
                        raise AssertionError("Blocking request stalled the event loop")
                    return original(*args, **kwargs)

                async def exercise():
                    loop_thread = threading.get_ident()
                    async with httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=app),
                        base_url="http://fixture.invalid",
                        headers={"Authorization": "Bearer " + self.token},
                    ) as client:
                        payload = {
                            "session_id": "alice-session",
                            "message": "summarize the document"
                            if operation == "retrieval"
                            else "latest news",
                            "mode": "DOCUMENT_RAG"
                            if operation == "retrieval"
                            else "WEB_SEARCH",
                        }
                        if operation == "retrieval":
                            payload["attachments"] = [
                                {"id": "document", "file_type": "document"}
                            ]
                        if operation == "login":
                            payload = {
                                "username_or_email": "alice",
                                "password": "Durable!482Strong",
                            }
                        request = asyncio.create_task(
                            client.post(
                                "/api/v1/user/login"
                                if operation == "login"
                                else "/api/v1/chat/stream",
                                json=payload,
                            )
                        )
                        try:
                            self.assertTrue(await asyncio.to_thread(started.wait, 3))
                            for url in (
                                "/api/v1/health",
                                "/api/v1/session/alice-session/history",
                            ):
                                response = await asyncio.wait_for(client.get(url), 1)
                                self.assertEqual(
                                    response.status_code, 200, response.text
                                )
                            self.assertFalse(request.done())
                            self.assertNotIn(loop_thread, worker_ids)
                        finally:
                            release.set()
                            response = await request
                        self.assertEqual(response.status_code, 200, response.text)
                        if operation != "login":
                            events = [
                                json.loads(frame[6:])
                                for frame in response.text.strip().split("\n\n")
                            ]
                            self.assertEqual(events[-1]["event"], "done")
                            self.assertTrue(
                                any(event["event"] == "token" for event in events)
                            )

                with (
                    patch.object(chat, "chat_orchestrator", actual),
                    patch.object(target, name, side_effect=slow),
                ):
                    asyncio.run(exercise())

    def test_cancellation_during_assistant_save_does_not_duplicate_the_answer(self):
        import threading

        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        original = actual._persist_message
        saved, release = threading.Event(), threading.Event()

        def slow_save(*args, **kwargs):
            result = original(*args, **kwargs)
            role = kwargs.get("role", args[1] if len(args) > 1 else None)
            if role == "assistant":
                saved.set()
                if not release.wait(5):
                    raise AssertionError("Assistant save was not released")
            return result

        async def exercise():
            async def consume():
                async for _ in actual.route_and_stream(
                    ChatRequest(session_id="alice-session", message="hello"),
                    self.principal,
                ):
                    pass

            task = asyncio.create_task(consume())
            try:
                self.assertTrue(await asyncio.to_thread(saved.wait, 3))
                task.cancel()
                await asyncio.sleep(0.02)
                self.assertFalse(task.done())
            finally:
                release.set()
            with self.assertRaises(asyncio.CancelledError):
                await task

        with patch.object(actual, "_persist_message", side_effect=slow_save):
            asyncio.run(exercise())
        messages = chat_history_service.get_session_messages("alice-session")
        self.assertEqual([message.role for message in messages], ["user", "assistant"])
        self.assertEqual(messages[1].content, "Fixture answer")

    def test_parallel_streams_keep_cancellation_and_saved_replies_separate(self):
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        llm = actual._route_and_stream.__func__.__globals__["llm_service"]
        for session_id in ("parallel-held", "parallel-complete"):
            security.ensure_session(session_id, self.principal)

        async def exercise():
            waiting = asyncio.Event()

            async def answer(query, *args, **kwargs):
                yield query
                if query == "held":
                    waiting.set()
                    await asyncio.Event().wait()
                yield " finished"

            async def consume(session_id, message):
                async for _ in actual.route_and_stream(
                    ChatRequest(session_id=session_id, message=message), self.principal
                ):
                    pass

            with patch.object(llm, "stream_conversational_answer", answer):
                held = asyncio.create_task(consume("parallel-held", "held"))
                try:
                    await asyncio.wait_for(waiting.wait(), 3)
                    await asyncio.wait_for(consume("parallel-complete", "complete"), 3)
                finally:
                    held.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await held

        asyncio.run(exercise())
        held = chat_history_service.get_session_messages("parallel-held")
        complete = chat_history_service.get_session_messages("parallel-complete")
        self.assertEqual(len(held), 2)
        self.assertEqual(len(complete), 2)
        self.assertEqual(held[1].content, "held\n\nResponse stopped.")
        self.assertEqual(complete[1].content, "complete finished")

    def test_concurrent_workers_share_one_session_cache_without_losing_messages(self):
        import sqlite3
        import threading

        from app.repositories.session_store import session_store_repo

        # Keep the disposable file open while SDK clients connect concurrently.
        # A remote Turso server owns that lifecycle in production.
        keeper = sqlite3.connect(database.DB_FILE)
        keeper.execute("SELECT COUNT(*) FROM chat_sessions").fetchall()
        self.addCleanup(keeper.close)
        barrier = threading.Barrier(8)

        def load(_):
            barrier.wait(timeout=5)
            return session_store_repo.get_or_create_session("alice-session")

        with ThreadPoolExecutor(max_workers=8) as workers:
            sessions = list(workers.map(load, range(8)))
            self.assertTrue(all(session is sessions[0] for session in sessions))
            list(
                workers.map(
                    lambda index: session_store_repo.record_message(
                        "alice-session",
                        "user",
                        f"message {index}",
                        message_id=str(index),
                    ),
                    range(16),
                )
            )
        self.assertEqual(
            sorted(message["id"] for message in sessions[0].messages),
            sorted(map(str, range(16))),
        )

    def test_stream_message_ids_match_reloaded_sql_and_cache_in_every_route(self):
        from app.api.v1.endpoints import chat
        from app.repositories.session_store import session_store_repo

        cases = [
            ("AUTO", "hello", []),
            ("DOCUMENT_RAG", "summarize the uploaded document", []),
            ("WEB_SEARCH", "latest weather forecast", []),
            ("MULTIMODAL", "read this image", [{"id": "image", "file_type": "image"}]),
            ("IMAGE_GENERATION", "draw a tree", []),
        ]
        for failed in (False, True):
            for index, (mode, prompt, attachments) in enumerate(cases):
                session_id = f"reply-{failed}-{index}"
                # The document fixture belongs to alice-session; include it explicitly.
                if mode == "DOCUMENT_RAG":
                    attachments = [{"id": "document", "file_type": "document"}]
                with (
                    self.subTest(mode=mode, failed=failed),
                    patch.object(
                        chat, "chat_orchestrator", self.reply_orchestrator(failed)
                    ),
                ):
                    response = self.request(
                        "POST",
                        "/chat/stream",
                        self.token,
                        json={
                            "session_id": session_id,
                            "mode": mode,
                            "message": prompt,
                            "attachments": attachments,
                        },
                    )
                self.assertEqual(response.status_code, 200, response.text)
                events = [
                    json.loads(frame[6:])
                    for frame in response.text.strip().split("\n\n")
                ]
                acknowledgements = [
                    event["message"] for event in events if event["event"] == "message"
                ]
                self.assertEqual(
                    [saved["role"] for saved in acknowledgements], ["user", "assistant"]
                )
                self.assertEqual(len({saved["id"] for saved in acknowledgements}), 2)
                history = self.request(
                    "GET", f"/session/{session_id}/history", self.token
                ).json()["messages"]
                self.assertEqual(
                    [saved["id"] for saved in acknowledgements],
                    [message["id"] for message in history],
                )
                self.assertEqual(
                    [saved["created_at"] for saved in acknowledgements],
                    [message["created_at"] for message in history],
                )
                self.assertTrue(
                    all(saved["session_id"] == session_id for saved in acknowledgements)
                )
                cached = session_store_repo.get_or_create_session(session_id).messages
                self.assertEqual(
                    [message["id"] for message in cached],
                    [message["id"] for message in history],
                )
                if failed:
                    self.assertLess(
                        next(
                            i
                            for i, event in enumerate(events)
                            if event["event"] == "message"
                            and event["message"]["role"] == "assistant"
                        ),
                        next(
                            i
                            for i, event in enumerate(events)
                            if event["event"] == "error"
                        ),
                    )
                # A reply made before navigation must still target exactly this row
                # after the conversation is fetched again.
                terminals = [
                    event for event in events if event["event"] in ("error", "done")
                ]
                self.assertEqual(
                    [event["event"] for event in terminals],
                    ["error" if failed else "done"],
                )
                displayed = "".join(
                    event["data"] for event in events if event["event"] == "token"
                )
                if failed:
                    displayed = "\n\n".join(
                        filter(
                            None,
                            [
                                displayed,
                                f"Response interrupted: {terminals[0]['data']}",
                            ],
                        )
                    )
                self.assertEqual(history[1]["content"], displayed)
                target = history[1]
                with patch.object(chat, "chat_orchestrator", self.reply_orchestrator()):
                    reply = self.request(
                        "POST",
                        "/chat/stream",
                        self.token,
                        json={
                            "session_id": session_id,
                            "mode": "AUTO",
                            "message": "hello",
                            "reply_to": {
                                "id": target["id"],
                                "role": "assistant",
                                "content": target["content"],
                            },
                        },
                    )
                self.assertEqual(reply.status_code, 200)
                reloaded = self.request(
                    "GET", f"/session/{session_id}/history", self.token
                ).json()["messages"]
                self.assertEqual(len(reloaded), 4)
                self.assertEqual(reloaded[2]["reply_to"]["id"], reloaded[1]["id"])

    def test_simple_messages_and_guest_memory_receive_real_ids_only_after_save(self):
        from app.repositories.session_store import session_store_repo
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()

        async def collect(iterator):
            return [json.loads(frame[6:]) async for frame in iterator]

        events = asyncio.run(
            collect(
                actual._emit_simple_message("No matching documents", "alice-session")
            )
        )
        saved = chat_history_service.get_session_messages("alice-session")[0]
        self.assertEqual(events[0]["message"]["id"], saved.id)
        self.assertEqual(events[-1]["event"], "done")
        with patch.object(
            chat_history_service,
            "save_message",
            side_effect=RuntimeError("fixture SQL failure"),
        ):
            observed = []

            async def failed_save():
                async for frame in actual._emit_simple_message(
                    "Must not acknowledge", "alice-session"
                ):
                    observed.append(frame)

            with self.assertRaises(RuntimeError):
                asyncio.run(failed_save())
            self.assertEqual(observed, [])

        guest = security.resolve_principal(
            security.digest(security.create_guest()["access_token"])
        )
        security.ensure_session("guest-reply-fixture", guest)
        events = asyncio.run(
            collect(
                actual.route_and_stream(
                    ChatRequest(session_id="guest-reply-fixture", message="hello"),
                    guest,
                )
            )
        )
        ids = [
            event["message"]["id"] for event in events if event["event"] == "message"
        ]
        self.assertEqual(len(ids), 2)
        self.assertEqual(
            [
                message["id"]
                for message in session_store_repo.get_history_messages(
                    "guest-reply-fixture"
                )
            ],
            ids,
        )
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT COUNT(*) FROM messages WHERE session_id=?",
                    ("guest-reply-fixture",),
                ).fetchone()[0],
                2,
            )

    def test_stopping_after_user_ack_keeps_its_id_without_inventing_an_assistant(self):
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        principal = security.resolve_principal(security.digest(self.token))

        async def cancel():
            iterator = actual.route_and_stream(
                ChatRequest(session_id="alice-session", message="hello"), principal
            )
            first = json.loads((await anext(iterator))[6:])
            await iterator.aclose()
            return first

        first = asyncio.run(cancel())
        self.assertEqual(first["message"]["role"], "user")
        history = chat_history_service.get_session_messages("alice-session")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0].id, first["message"]["id"])

    def test_stream_stop_preserves_partial_text_and_media_in_all_modes(self):
        from app.repositories.session_store import session_store_repo
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        principal = security.resolve_principal(security.digest(self.token))
        for mode, prompt, attachments in [
            ("AUTO", "hello", []),
            (
                "DOCUMENT_RAG",
                "summarize document",
                [{"id": "document", "file_type": "document"}],
            ),
            ("WEB_SEARCH", "latest weather forecast", []),
            ("MULTIMODAL", "read this image", [{"id": "image", "file_type": "image"}]),
            ("IMAGE_GENERATION", "draw a tree", []),
        ]:
            with self.subTest(mode=mode):
                session_id = "stopped-" + mode.lower()
                security.ensure_session(session_id, principal)
                actual = self.reply_orchestrator()

                async def stop():
                    iterator = actual.route_and_stream(
                        ChatRequest(
                            session_id=session_id,
                            mode=mode,
                            message=prompt,
                            attachments=attachments,
                        ),
                        principal,
                    )
                    observed = []
                    async for frame in iterator:
                        event = json.loads(frame[6:])
                        observed.append(event)
                        if event["event"] in ("token", "media"):
                            break
                    await iterator.aclose()
                    return observed

                observed = asyncio.run(stop())
                history = chat_history_service.get_session_messages(session_id)
                self.assertEqual(len(history), 2)
                self.assertEqual(
                    history[1].content,
                    "\n\n".join(
                        filter(
                            None,
                            [
                                "".join(
                                    event["data"]
                                    for event in observed
                                    if event["event"] == "token"
                                ),
                                "Response stopped.",
                            ],
                        )
                    ),
                )
                if mode == "IMAGE_GENERATION":
                    saved_attachments = history[1].attachments
                    if not saved_attachments:
                        self.fail("Stopped image response must retain its attachment.")
                    self.assertEqual(
                        saved_attachments[0].id, observed[-1]["media"]["id"]
                    )
                else:
                    self.assertTrue(history[1].content)
                if mode in ("DOCUMENT_RAG", "WEB_SEARCH"):
                    self.assertTrue(history[1].citations)
                self.assertEqual(
                    session_store_repo.get_history_messages(session_id)[1]["content"],
                    history[1].content,
                )

    def test_stream_cancellation_during_provider_wait_saves_partial_once_and_closes_provider(
        self,
    ):
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        principal = security.resolve_principal(security.digest(self.token))
        actual = self.reply_orchestrator()
        closed = []

        async def verify():
            waiting = asyncio.Event()

            async def provider(*args, **kwargs):
                try:
                    yield "Partial fixture"
                    waiting.set()
                    await asyncio.Event().wait()
                finally:
                    closed.append(True)

            llm = actual._execute_conversational.__func__.__globals__["llm_service"]
            with patch.object(llm, "stream_conversational_answer", provider):
                iterator = actual.route_and_stream(
                    ChatRequest(session_id="alice-session", message="hello"), principal
                )
                async for frame in iterator:
                    if json.loads(frame[6:])["event"] == "token":
                        break
                task = asyncio.create_task(anext(iterator))
                await waiting.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                await iterator.aclose()

        asyncio.run(verify())
        self.assertEqual(closed, [True])
        history = chat_history_service.get_session_messages("alice-session")
        self.assertEqual(len(history), 2)
        self.assertEqual(history[1].content, "Partial fixture\n\nResponse stopped.")

    def test_stream_disconnect_closes_generator_and_saves_partial_for_both_asgi_versions(
        self,
    ):
        from starlette.requests import ClientDisconnect

        from app.api.v1.endpoints import chat
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        principal = security.resolve_principal(security.digest(self.token))
        for spec in ("2.3", "2.4"):
            with self.subTest(spec=spec):
                session_id = "disconnect-" + spec.replace(".", "-")
                security.ensure_session(session_id, principal)
                actual = self.reply_orchestrator()
                closed = []

                async def provider(*args, **kwargs):
                    try:
                        yield "Partial fixture"
                        await asyncio.Event().wait()
                    finally:
                        closed.append(True)

                llm = actual._execute_conversational.__func__.__globals__["llm_service"]

                async def disconnect():
                    disconnected = asyncio.Event()

                    async def receive():
                        await disconnected.wait()
                        return {"type": "http.disconnect"}

                    async def send(message):
                        if (
                            message["type"] == "http.response.body"
                            and b'"event": "token"' in message.get("body", b"")
                        ):
                            if spec == "2.4":
                                raise OSError("Fixture socket closed")
                            disconnected.set()

                    with (
                        patch.object(llm, "stream_conversational_answer", provider),
                        patch.object(chat, "chat_orchestrator", actual),
                    ):
                        response = await chat.chat_stream(
                            ChatRequest(session_id=session_id, message="hello"),
                            principal,
                        )
                        try:
                            await asyncio.wait_for(
                                response(
                                    {"type": "http", "asgi": {"spec_version": spec}},
                                    receive,
                                    send,
                                ),
                                timeout=2,
                            )
                        except ClientDisconnect:
                            if spec != "2.4":
                                raise
                        self.assertEqual(closed, [True])
                        history = chat_history_service.get_session_messages(session_id)
                        self.assertEqual(
                            [message.content for message in history],
                            ["hello", "Partial fixture\n\nResponse stopped."],
                        )

                asyncio.run(disconnect())

    def test_stream_stop_cannot_restore_cleared_or_deleted_history(self):
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        principal = security.resolve_principal(security.digest(self.token))
        for deleted in (False, True):
            session_id = "stop-invalidated-" + str(deleted)
            security.ensure_session(session_id, principal)
            actual = self.reply_orchestrator()

            async def stop():
                iterator = actual.route_and_stream(
                    ChatRequest(session_id=session_id, message="hello"), principal
                )
                async for frame in iterator:
                    if json.loads(frame[6:])["event"] == "token":
                        break
                if deleted:
                    from app.services.session_lifecycle import request_deletion

                    request_deletion(session_id)
                else:
                    chat_history_service.clear_session_messages(session_id)
                await iterator.aclose()

            asyncio.run(stop())
            self.assertEqual(chat_history_service.get_session_messages(session_id), [])

    def test_stream_stop_after_saved_assistant_ack_does_not_duplicate_message(self):
        from app.schemas.chat import ChatRequest
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        principal = security.resolve_principal(security.digest(self.token))

        async def stop():
            iterator = actual.route_and_stream(
                ChatRequest(session_id="alice-session", message="hello"), principal
            )
            async for frame in iterator:
                event = json.loads(frame[6:])
                if (
                    event["event"] == "message"
                    and event["message"]["role"] == "assistant"
                ):
                    break
            await iterator.aclose()

        asyncio.run(stop())
        self.assertEqual(
            len(chat_history_service.get_session_messages("alice-session")), 2
        )

    def test_legacy_reply_previews_survive_without_guessing_and_dom_ids_normalize(self):
        from app.services.chat_history_service import chat_history_service as service

        target = service.save_message("alice-session", "assistant", "Repeated answer")
        service.save_message("alice-session", "assistant", "Repeated answer")
        cases = [
            ("msg-asst-123", "Repeated answer", "msg-asst-123"),
            ("usr_456", "User preview", "usr_456"),
            ("stopped-789", "Repeated answer", "stopped-789"),
            (
                "11111111-1111-4111-8111-111111111111",
                "Missing target preview",
                "11111111-1111-4111-8111-111111111111",
            ),
            ("msg-" + target.id, target.content, target.id),
            (target.id, target.content, target.id),
        ]
        expected_replies = []
        for identifier, content, expected in cases:
            saved = service.save_message(
                "alice-session",
                "user",
                "Reply fixture",
                reply_to={
                    "id": identifier,
                    "role": "assistant",
                    "content": content,
                },
            )
            expected_replies.append((saved.id, expected, content))
        history = service.get_session_messages("alice-session")
        by_id = {message.id: message for message in history}
        for identifier, expected, content in expected_replies:
            reply = by_id[identifier].reply_to
            assert reply is not None
            self.assertEqual(reply.id, expected)
            self.assertEqual(reply.content, content)

    def test_clear_messages_cannot_revive_signed_in_history_from_another_worker(self):
        from app.repositories.session_store import (
            SessionStoreRepository,
            session_store_repo,
        )
        from app.services.chat_history_service import chat_history_service

        other_worker = SessionStoreRepository()
        chat_history_service.save_message("alice-session", "user", "Private fixture")
        for repository in (session_store_repo, other_worker):
            repository.record_message("alice-session", "user", "Private fixture")
            self.assertEqual(len(repository.get_history_messages("alice-session")), 1)
        security.ensure_session(
            "bob-session", security.resolve_principal(security.digest(self.other_token))
        )
        chat_history_service.save_message("bob-session", "user", "Bob keeps this")
        response = self.request("DELETE", "/session/alice-session/messages", self.token)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(session_store_repo._sessions["alice-session"].messages, [])
        for repository in (session_store_repo, other_worker):
            self.assertEqual(repository.get_history_messages("alice-session"), [])
            # Even an old callback/cache snapshot must not override empty SQL.
            repository._sessions["alice-session"].messages.append(
                {"role": "user", "content": "stale"}
            )
            self.assertEqual(repository.get_history_messages("alice-session"), [])
        self.assertEqual(
            len(chat_history_service.get_session_messages("bob-session")), 1
        )
        self.assertIsNotNone(chat_history_service.get_session("alice-session"))
        self.assertEqual(
            len(chat_history_service.list_session_documents("alice-session")), 1
        )
        self.assertTrue((settings.UPLOAD_IMAGE_DIR / "fixture.png").exists())
        chat_history_service.save_message("alice-session", "user", "Fresh message")
        self.assertEqual(
            [m["content"] for m in other_worker.get_history_messages("alice-session")],
            ["Fresh message"],
        )

    def test_guest_clear_invalidates_other_worker_memory_without_persisting_messages(
        self,
    ):
        from app.repositories.session_store import (
            SessionStoreRepository,
            session_store_repo,
        )
        from app.services.chat_history_service import chat_history_service

        guest = self.request("POST", "/user/guest").json()
        token = guest["access_token"]
        principal = security.resolve_principal(security.digest(token))
        security.ensure_session("guest-clear", principal)
        other_worker = SessionStoreRepository()
        for repository in (session_store_repo, other_worker):
            repository.record_message("guest-clear", "user", "Guest fixture")
            self.assertEqual(
                repository.get_history_messages("guest-clear")[0]["content"],
                "Guest fixture",
            )
        self.assertEqual(
            self.request(
                "DELETE", "/session/guest-clear/messages", self.other_token
            ).status_code,
            404,
        )
        self.assertEqual(len(other_worker.get_history_messages("guest-clear")), 1)
        for _ in range(2):
            response = self.request("DELETE", "/session/guest-clear/messages", token)
            self.assertEqual(response.status_code, 200, response.text)
            for repository in (session_store_repo, other_worker):
                self.assertEqual(repository.get_history_messages("guest-clear"), [])
        other_worker.record_message("guest-clear", "user", "Fresh guest message")
        self.assertEqual(
            other_worker.get_history_messages("guest-clear")[0]["content"],
            "Fresh guest message",
        )
        # A delayed notification from the first clear cannot erase newer history.
        other_worker.invalidate_cached_history("guest-clear", 1)
        self.assertEqual(len(other_worker.get_history_messages("guest-clear")), 1)
        self.assertEqual(chat_history_service.get_session_messages("guest-clear"), [])

    def test_failed_clear_rolls_back_sql_and_keeps_cached_history(self):
        from app.repositories.session_store import session_store_repo
        from app.services import chat_history_service as history_module

        service = history_module.chat_history_service
        service.save_message("alice-session", "user", "Keep until clear succeeds")
        session_store_repo.record_message(
            "alice-session", "user", "Keep until clear succeeds"
        )

        @contextmanager
        def failed_commit(**kwargs):
            with database.get_db_connection(**kwargs) as conn:
                yield conn
                raise RuntimeError("fixture commit failure")

        with patch.object(history_module, "get_db_connection", failed_commit):
            with self.assertRaisesRegex(RuntimeError, "fixture commit failure"):
                service.clear_session_messages("alice-session")
        self.assertEqual(len(service.get_session_messages("alice-session")), 1)
        self.assertEqual(len(session_store_repo._sessions["alice-session"].messages), 1)
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT history_version FROM chat_sessions WHERE id='alice-session'"
                ).fetchone()[0],
                0,
            )

    def test_history_version_migration_preserves_existing_rows_and_is_repeatable(self):
        from app.services.chat_history_service import chat_history_service

        chat_history_service.save_message("alice-session", "user", "Keep fixture")
        with database.get_db_connection(write=True) as conn:
            conn.execute("ALTER TABLE chat_sessions DROP COLUMN history_version")
        database.init_db()
        database.init_db()
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT history_version FROM chat_sessions WHERE id='alice-session'"
                ).fetchone()[0],
                0,
            )
        self.assertEqual(
            len(chat_history_service.get_session_messages("alice-session")), 1
        )
        self.assertEqual(
            len(chat_history_service.list_session_documents("alice-session")), 1
        )

    def test_http_cancellation_does_not_clean_an_active_upload_worker(self):
        import threading

        from app.api.v1.endpoints import document
        from app.services.upload_lifecycle import purge_failed_uploads

        rag, _, embedder = self._load_document_pipeline()
        started, release, finished = (
            threading.Event(),
            threading.Event(),
            threading.Event(),
        )

        def embed(texts):
            started.set()
            if not release.wait(10):
                raise AssertionError("Test did not release embedding worker")
            raise RuntimeError("fixture abandoned upload")

        embedder.embed_batch.side_effect = embed
        original = document._store_and_index_document

        def pipeline(*args):
            try:
                return original(*args)
            finally:
                finished.set()

        async def exercise(objects, original_keys):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://fixture.invalid",
            ) as client:
                task = asyncio.create_task(
                    client.post(
                        "/api/v1/document/upload",
                        headers={"Authorization": "Bearer " + self.token},
                        data={"session_id": "alice-session"},
                        files={"file": ("cancel.txt", b"test", "text/plain")},
                    )
                )
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 5))
                    task.cancel()
                    await asyncio.sleep(0.02)
                    # Started work keeps its input until indexing and rollback finish.
                    self.assertFalse(task.done())
                    self.assertTrue(list(settings.UPLOAD_DIR.glob("*.txt")))
                    self.assertEqual(purge_failed_uploads(), 0)
                    self.assertEqual(len(objects), len(original_keys) + 1)
                    release.set()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                    self.assertFalse(list(settings.UPLOAD_DIR.glob("*.txt")))
                finally:
                    release.set()
                    if not task.done():
                        task.cancel()
                    self.assertTrue(await asyncio.to_thread(finished.wait, 10))

        with (
            self._isolated_r2() as (objects, _),
            patch.object(document, "rag_service", rag),
            patch.object(document, "_store_and_index_document", side_effect=pipeline),
        ):
            original_keys = set(objects)
            asyncio.run(exercise(objects, original_keys))
            self.assertEqual(set(objects), original_keys)

    def test_cleanup_database_error_does_not_mark_a_live_upload_as_failed(self):
        from app.services import upload_lifecycle
        from app.services.storage_service import storage_service

        with upload_lifecycle.upload_attempt():
            attempt_id = upload_lifecycle.current_upload_attempt.get()
            assert attempt_id is not None
            key = "documents/alice-session/live-db-error.txt"
            storage_service.upload_file(b"test", key, session_id="alice-session")
            with patch.object(
                upload_lifecycle,
                "get_db_connection",
                side_effect=OSError("fixture database unavailable"),
            ):
                self.assertFalse(upload_lifecycle.cleanup_upload(attempt_id))
            with database.get_db_connection() as conn:
                self.assertEqual(
                    conn.execute(
                        "SELECT state FROM upload_attempts WHERE id=?", (attempt_id,)
                    ).fetchone()[0],
                    "pending",
                )
            self.assertTrue((root / key).exists())
        self.assertFalse((root / key).exists())

    @contextmanager
    def _isolated_r2(self):
        from app.services.storage_service import storage_service

        objects = {
            "media/uploads/fixture.png": b"fixture-image",
            "documents/alice-session/fixture.txt": b"fixture",
        }
        client = Mock()

        def put(**kwargs):
            objects[kwargs["Key"]] = kwargs["Body"]

        def delete(**kwargs):
            objects.pop(kwargs["Key"], None)

        def get(**kwargs):
            content = objects[kwargs["Key"]]
            return {"Body": io.BytesIO(content), "ContentLength": len(content)}

        client.put_object.side_effect = put
        client.delete_object.side_effect = delete
        client.get_object.side_effect = get
        with (
            patch.object(storage_service, "_initialized", True),
            patch.object(storage_service, "_s3_client", client),
            patch.object(
                settings, "CLOUDFLARE_R2_PUBLIC_URL", "https://storage.fixture.invalid"
            ),
        ):
            yield objects, client

    def test_failed_txt_and_pdf_uploads_remove_only_their_own_r2_objects(self):
        from app.api.v1.endpoints import document

        rag, _, embedder = self._load_document_pipeline()
        embedder.embed_batch.side_effect = RuntimeError("fixture embedding failure")
        with (
            self._isolated_r2() as (objects, client),
            patch.object(document, "rag_service", rag),
        ):
            original_objects = dict(objects)
            for filename, content, mime in (
                ("failed.txt", b"test", "text/plain"),
                ("failed.pdf", self.pdf_fixture("test"), "application/pdf"),
            ):
                response = self.request(
                    "POST",
                    "/document/upload",
                    self.token,
                    data={"session_id": "alice-session"},
                    files={"file": (filename, content, mime)},
                )
                self.assertEqual(response.status_code, 500)
                self.assertEqual(objects, original_objects)
                self.assertIn("fixture embedding failure", response.json()["detail"])
            self.assertEqual(client.put_object.call_count, 2)
            self.assertEqual(client.delete_object.call_count, 2)
            with database.get_db_connection() as conn:
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM upload_attempts").fetchone()[0],
                    0,
                )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM upload_resources").fetchone()[0],
                    0,
                )

    def test_failed_partial_index_and_r2_cleanup_retry_survive_restart(self):
        from app.api.v1.endpoints import document
        from app.services import session_lifecycle

        rag, repository, _ = self._load_document_pipeline()
        repository.collection.add.side_effect = RuntimeError(
            "fixture partial index failure"
        )
        with (
            self._isolated_r2() as (objects, client),
            patch.object(document, "rag_service", rag),
            patch.object(vectors, "delete_document") as delete_vectors,
        ):
            original_keys = set(objects)
            delete_object = client.delete_object.side_effect
            client.delete_object.side_effect = RuntimeError("fixture R2 unavailable")
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("failed.txt", b"test", "text/plain")},
            )
            self.assertEqual(response.status_code, 500)
            failed_key = client.put_object.call_args.kwargs["Key"]
            self.assertIn(failed_key, objects)
            with database.get_db_connection() as conn:
                self.assertEqual(
                    conn.execute("SELECT state FROM upload_attempts").fetchone()[0],
                    "failed",
                )
            database.init_db()
            client.delete_object.side_effect = delete_object
            session_lifecycle.purge_expired_sessions()
            self.assertEqual(set(objects), original_keys)
            document_id = repository.collection.add.call_args.kwargs["metadatas"][0][
                "document_id"
            ]
            delete_vectors.assert_called_once_with(document_id, raise_on_error=True)
            with database.get_db_connection() as conn:
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM upload_attempts").fetchone()[0],
                    0,
                )
            self.assertEqual(
                self.request("GET", "/media/assets", self.token).json()["total"], 2
            )

    def test_media_registration_rollback_cleans_uploads_and_generated_images(self):
        from app.services import media_service as media_module

        original_publish = media_module.publish_upload

        def reject_commit(conn):
            original_publish(conn)
            raise RuntimeError("fixture registration rollback")

        with (
            self._isolated_r2() as (objects, _),
            patch.object(media_module, "publish_upload", side_effect=reject_commit),
        ):
            original_objects = dict(objects)
            for session_id in (None, "alice-session"):
                for generated in (False, True):
                    with self.assertRaises(RuntimeError):
                        if generated:
                            media_module.media_service.save_generated_image(
                                self.image_fixture(),
                                "fixture",
                                session_id,
                                self.alice.id,
                            )
                        else:
                            media_module.media_service.save_uploaded_media(
                                self.image_fixture(),
                                "fixture.png",
                                session_id,
                                self.alice.id,
                            )
                    self.assertEqual(objects, original_objects)
            with database.get_db_connection() as conn:
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0], 1
                )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM upload_attempts").fetchone()[0],
                    0,
                )

    def test_published_uploads_are_preserved_by_failed_upload_sweeper_and_chat_deletion(
        self,
    ):
        from app.api.v1.endpoints import document
        from app.services.upload_lifecycle import purge_failed_uploads

        rag, _, _ = self._load_document_pipeline()
        with (
            self._isolated_r2() as (objects, client),
            patch.object(document, "rag_service", rag),
        ):
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("success.txt", b"test", "text/plain")},
            )
            self.assertEqual(response.status_code, 201)
            self.assertEqual(purge_failed_uploads(), 0)
            self.assertEqual(
                self.request(
                    "DELETE", "/session/alice-session", self.token
                ).status_code,
                200,
            )
            self.assertEqual(purge_failed_uploads(), 0)
            self.assertIn(client.put_object.call_args.kwargs["Key"], objects)
            client.delete_object.assert_not_called()

    def test_abandoned_upload_is_cleaned_but_live_and_unclassified_objects_are_preserved(
        self,
    ):
        from fastapi import HTTPException

        from app.services import upload_lifecycle
        from app.services.chat_history_service import chat_history_service

        stale_key, live_key, unknown_key = (
            "documents/alice-session/stale.txt",
            "documents/alice-session/live.txt",
            "documents/alice-session/unknown.txt",
        )
        with self._isolated_r2() as (objects, _):
            objects.update(
                {stale_key: b"stale", live_key: b"live", unknown_key: b"unknown"}
            )
            with database.get_db_connection(write=True) as conn:
                conn.execute(
                    "INSERT INTO upload_attempts (id,expires_at) VALUES ('stale',0)"
                )
                conn.execute(
                    "INSERT INTO upload_attempts (id,expires_at) VALUES ('live',?)",
                    (time.time() + 300,),
                )
                for attempt, key in (("stale", stale_key), ("live", live_key)):
                    conn.execute(
                        "INSERT INTO upload_resources VALUES (?,?,'r2',?)",
                        (attempt, "alice-session", key),
                    )
            self.assertEqual(upload_lifecycle.purge_failed_uploads(), 1)
            self.assertNotIn(stale_key, objects)
            self.assertIn(live_key, objects)
            self.assertIn(unknown_key, objects)
            token = upload_lifecycle.current_upload_attempt.set("stale")
            try:
                with self.assertRaises(HTTPException):
                    chat_history_service.save_document(
                        "too-late",
                        self.alice.id,
                        "alice-session",
                        "late.txt",
                        "txt",
                        4,
                        1,
                    )
            finally:
                upload_lifecycle.current_upload_attempt.reset(token)
            with database.get_db_connection() as conn:
                self.assertIsNone(
                    conn.execute(
                        "SELECT 1 FROM documents WHERE id='too-late'"
                    ).fetchone()
                )
            self.assertEqual(upload_lifecycle.purge_failed_uploads(), 0)

    def _load_document_pipeline(self):
        """Run real ingestion/vector code with only provider calls replaced."""
        chroma = types.ModuleType("chromadb")
        setattr(chroma, "PersistentClient", Mock())
        embedding = types.ModuleType("app.services.embedding_service")
        embedder = Mock()
        embedder.embedding_space = "fixture-space"
        embedder.embed_batch.side_effect = lambda texts: [[1.0, 0.0] for _ in texts]
        setattr(embedding, "embedding_service", embedder)
        with (
            patch.dict(
                sys.modules, {"chromadb": chroma, embedding.__name__: embedding}
            ),
            patch.multiple(
                settings,
                VECTOR_STORE_TYPE="chroma",
                CHUNK_SIZE=800,
                CHUNK_OVERLAP=150,
                create=True,
            ),
        ):
            repository = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1]
                    / "app/repositories/vector_store.py"
                )
            )["vector_store_repo"]
            vector_module = types.ModuleType("app.repositories.vector_store")
            setattr(vector_module, "vector_store_repo", repository)
            with patch.dict(sys.modules, {vector_module.__name__: vector_module}):
                rag = runpy.run_path(
                    str(
                        Path(__file__).resolve().parents[1]
                        / "app/services/rag_service.py"
                    )
                )["rag_service"]
        return rag, repository, embedder

    def test_embedding_provenance_migration_preserves_legacy_files_and_rows(self):
        previous_clears = vectors.clear_all.call_count
        with database.get_db_connection() as conn:
            conn.execute("ALTER TABLE documents DROP COLUMN embedding_space")
        database.init_db()
        database.init_db()
        with database.get_db_connection() as conn:
            row = conn.execute(
                "SELECT filename,embedding_space FROM documents WHERE id='document'"
            ).fetchone()
            self.assertIsNotNone(row)
            assert row is not None
            self.assertEqual(row["filename"], "fixture.txt")
            self.assertIsNone(row["embedding_space"])
        self.assertTrue((root / "documents/alice-session/fixture.txt").exists())
        self.assertEqual(vectors.clear_all.call_count, previous_clears)

    def test_embedding_failure_returns_503_rolls_back_r2_and_retry_records_space(self):
        from app.api.v1.endpoints import document
        from app.core.errors import EmbeddingError

        rag, repository, embedder = self._load_document_pipeline()
        embedder.embed_batch.side_effect = EmbeddingError(
            "The document embedding service is temporarily unavailable. Please try again later."
        )
        with (
            self._isolated_r2() as (objects, _),
            patch.object(document, "rag_service", rag),
        ):
            before = set(objects)
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("failed.txt", b"test", "text/plain")},
            )
            self.assertEqual(response.status_code, 503, response.text)
            self.assertIn("temporarily unavailable", response.json()["detail"])
            self.assertEqual(set(objects), before)
            self.assertFalse(list(settings.UPLOAD_DIR.iterdir()))
            repository.collection.add.assert_not_called()
            embedder.embed_batch.side_effect = lambda texts: [[1.0, 0.0] for _ in texts]
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("retry.txt", b"test", "text/plain")},
            )
            self.assertEqual(response.status_code, 201, response.text)
            document_id = response.json()["document"]["document_id"]
            with database.get_db_connection() as conn:
                row = conn.execute(
                    "SELECT embedding_space FROM documents WHERE id=?", (document_id,)
                ).fetchone()
                assert row is not None
                self.assertEqual(row["embedding_space"], "fixture-space")
            self.assertTrue(
                all(
                    meta["embedding_space"] == "fixture-space"
                    for meta in repository.collection.add.call_args.kwargs["metadatas"]
                )
            )
            self.assertEqual(len(objects), len(before) + 1)
            self.assertTrue(before.issubset(objects))

    def test_embedding_compatibility_and_threshold_never_force_unrelated_context(self):
        from app.core.errors import EmbeddingCompatibilityError

        rag, repository, embedder = self._load_document_pipeline()
        embedder.embed_text.return_value = [1.0, 0.0]
        for provenance in (None, "another-model", "google:fixture:dimension:3:v1"):
            with self.subTest(provenance=provenance):
                with database.get_db_connection() as conn:
                    conn.execute(
                        "UPDATE documents SET embedding_space=? WHERE id='document'",
                        (provenance,),
                    )
                with self.assertRaises(EmbeddingCompatibilityError):
                    rag.retrieve_context_for_query("question", "alice-session")
                embedder.embed_text.assert_not_called()
                repository.collection.query.assert_not_called()
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE documents SET embedding_space='fixture-space' WHERE id='document'"
            )
        metadata = {"document_id": "document", "embedding_space": "fixture-space"}
        for distances, expected in (([0.9], []), ([0.9, 0.1], ["strong"])):
            repository.collection.query.return_value = {
                "ids": [["weak", "strong"][: len(distances)]],
                "documents": [["unrelated", "relevant"][: len(distances)]],
                "metadatas": [[metadata] * len(distances)],
                "distances": [distances],
            }
            result = rag.retrieve_context_for_query("question", "alice-session")
            self.assertEqual([chunk["chunk_id"] for chunk in result], expected)
        with database.get_db_connection() as conn:
            self.assertIsNotNone(
                conn.execute("SELECT id FROM documents WHERE id='document'").fetchone()
            )

    def test_embedding_space_filters_reject_legacy_and_foreign_vectors_on_both_backends(
        self,
    ):
        from app.core.errors import EmbeddingError

        _, repository, _ = self._load_document_pipeline()
        metas = [
            {"document_id": "document"},
            {"document_id": "document", "embedding_space": "other"},
            {"document_id": "foreign", "embedding_space": "fixture-space"},
            {"document_id": "document", "embedding_space": "fixture-space"},
        ]
        for cloud in (False, True):
            with self.subTest(cloud=cloud):
                repository.use_pinecone = cloud
                repository.index = Mock()
                repository.collection.query.return_value = {
                    "ids": [["legacy", "different", "foreign", "good"]],
                    "documents": [["test"] * 4],
                    "metadatas": [metas],
                    "distances": [[0.0] * 4],
                }
                repository.index.query.return_value = {
                    "matches": [
                        {"id": name, "metadata": meta, "score": 1.0}
                        for name, meta in zip(
                            ["legacy", "different", "foreign", "good"], metas
                        )
                    ]
                }
                result = repository.similarity_search(
                    [1.0, 0.0],
                    document_ids=["document"],
                    embedding_space="fixture-space",
                )
                self.assertEqual([chunk["chunk_id"] for chunk in result], ["good"])
                search = (
                    repository.index.query if cloud else repository.collection.query
                )
                filter_value = search.call_args.kwargs["filter" if cloud else "where"]
                self.assertIn("embedding_space", str(filter_value))
                repository.collection.query.return_value = {
                    "ids": [["invalid-score"]],
                    "documents": [["test"]],
                    "metadatas": [[metas[-1]]],
                    "distances": [[float("nan")]],
                }
                repository.index.query.return_value = {
                    "matches": [
                        {
                            "id": "invalid-score",
                            "metadata": metas[-1],
                            "score": float("inf"),
                        }
                    ]
                }
                self.assertEqual(
                    repository.similarity_search(
                        [1.0, 0.0],
                        document_ids=["document"],
                        embedding_space="fixture-space",
                    ),
                    [],
                )
                search.reset_mock()
                self.assertEqual(
                    repository.similarity_search(
                        [1.0, 0.0], document_ids=[], embedding_space="fixture-space"
                    ),
                    [],
                )
                search.assert_not_called()
                search.side_effect = RuntimeError("private fixture failure")
                with self.assertRaises(EmbeddingError) as caught:
                    repository.similarity_search(
                        [1.0, 0.0],
                        document_ids=["document"],
                        embedding_space="fixture-space",
                    )
                self.assertNotIn("private fixture", str(caught.exception))
                repository.client.delete_collection.assert_not_called()
                repository.index.delete.assert_not_called()
                repository.collection.delete.assert_not_called()

    def test_embedding_errors_reach_chat_and_empty_matches_do_not_call_general_ai(self):
        from app.api.v1.endpoints import chat
        from app.core.errors import EmbeddingError
        from app.services.chat_history_service import chat_history_service

        actual = self.reply_orchestrator()
        services = actual._route_and_stream.__func__.__globals__
        services["rag_service"].retrieve_context_for_query.side_effect = EmbeddingError(
            "Document search is temporarily unavailable. Please try again later."
        )
        with patch.object(chat, "chat_orchestrator", actual):
            response = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={
                    "session_id": "alice-session",
                    "message": "Review",
                    "attachments": [{"id": "document", "file_type": "document"}],
                },
            )
        events = [
            json.loads(frame[6:]) for frame in response.text.strip().split("\n\n")
        ]
        self.assertEqual(events[-1]["event"], "error")
        self.assertIn("temporarily unavailable", events[-1]["data"])
        self.assertIn(
            "temporarily unavailable",
            chat_history_service.get_session_messages("alice-session")[-1].content,
        )
        services["rag_service"].retrieve_context_for_query.side_effect = None
        services["rag_service"].retrieve_context_for_query.return_value = []
        fallback = Mock()
        with patch.object(
            services["llm_service"], "stream_conversational_answer", fallback
        ):

            async def collect():
                return [
                    json.loads(frame[6:])
                    async for frame in actual._execute_document_rag(
                        "question", "alice-session", allow_fallback=True
                    )
                ]

            events = asyncio.run(collect())
        fallback.assert_not_called()
        self.assertFalse(any(event["event"] == "citations" for event in events))
        self.assertTrue(
            any("could not find" in event.get("data", "") for event in events)
        )

        for needs_web in (False, True):
            with (
                self.subTest(needs_web=needs_web),
                patch.object(chat, "chat_orchestrator", actual),
                patch.object(
                    actual.routing, "is_conversational_query", return_value=False
                ),
                patch.object(
                    actual.routing, "needs_web_search", return_value=needs_web
                ),
            ):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "alice-session",
                        "message": "Research current events",
                        "mode": "AUTO",
                    },
                )
            events = [
                json.loads(frame[6:]) for frame in response.text.strip().split("\n\n")
            ]
            self.assertEqual(events[-1]["event"], "done")
            self.assertEqual(
                any(event["event"] == "citations" for event in events), needs_web
            )
            if not needs_web:
                # A new AUTO topic must use conversation, not an old document's empty matches.
                answer = "".join(
                    event.get("data", "")
                    for event in events
                    if event["event"] == "token"
                )
                self.assertEqual(answer, "Fixture answer")

    def test_local_vector_index_and_search_execute_runtime_type_casts(self):
        _, repository, _ = self._load_document_pipeline()
        metadata = {
            "document_id": "runtime-document",
            "embedding_space": "fixture-space",
            "page_number": 1,
            "chunk_index": 0,
        }
        repository.add_chunks(
            "runtime-document",
            ["runtime-chunk"],
            [[1.0, 0.0]],
            ["Searchable fixture text"],
            [metadata],
        )
        repository.collection.add.assert_called_once_with(
            ids=["runtime-chunk"],
            embeddings=[[1.0, 0.0]],
            documents=["Searchable fixture text"],
            metadatas=[metadata],
        )
        repository.collection.query.return_value = {
            "ids": [["runtime-chunk"]],
            "documents": [["Searchable fixture text"]],
            "metadatas": [[metadata]],
            "distances": [[0.0]],
        }
        for document_ids, where in (
            (None, None),
            (["runtime-document"], {"document_id": "runtime-document"}),
            (
                ["runtime-document", "another"],
                {"document_id": {"$in": ["runtime-document", "another"]}},
            ),
        ):
            result = repository.similarity_search(
                [1.0, 0.0], document_ids=document_ids, embedding_space="fixture-space"
            )
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["text"], "Searchable fixture text")
            self.assertEqual(
                repository.collection.query.call_args.kwargs["where"],
                {"$and": [where, {"embedding_space": "fixture-space"}]}
                if where
                else {"embedding_space": "fixture-space"},
            )

    def test_dimension_errors_never_reset_or_retry_the_shared_index(self):
        from app.core.errors import EmbeddingDimensionError

        _, repository, _ = self._load_document_pipeline()
        for cloud, message in (
            (False, "Collection expecting embedding with dimension of 2, got 3"),
            (False, "Embedding dimension 3 does not match collection dimensionality 2"),
            (True, "Vector dimension 3 does not match the dimension of the index 2"),
        ):
            with self.subTest(cloud=cloud, message=message):
                repository.use_pinecone = cloud
                repository.index = Mock()
                repository.collection.add.reset_mock(side_effect=True)
                write = repository.index.upsert if cloud else repository.collection.add
                write.side_effect = ValueError(message)
                with self.assertRaises(EmbeddingDimensionError):
                    repository.add_chunks(
                        "failed",
                        ["failed-chunk"],
                        [[1.0, 0.0, 0.0]],
                        ["test"],
                        [{"document_id": "failed"}],
                    )
                self.assertEqual(write.call_count, 1)
                repository.client.delete_collection.assert_not_called()
                repository.index.delete.assert_not_called()
                self.assertEqual(
                    repository.client.get_or_create_collection.call_count, 1
                )

        failure = RuntimeError("fixture provider unavailable")
        repository.index.upsert.side_effect = failure
        with self.assertRaises(RuntimeError) as caught:
            repository.add_chunks("failed", ["chunk"], [[1.0]], ["test"], [{}])
        self.assertIs(caught.exception, failure)
        repository.client.delete_collection.assert_not_called()
        repository.index.delete.assert_not_called()

    def test_inconsistent_dimensions_are_rejected_before_any_batch_is_written(self):
        from app.core.errors import EmbeddingDimensionError

        _, repository, _ = self._load_document_pipeline()
        for cloud in (False, True):
            repository.use_pinecone = cloud
            repository.index = Mock()
            for embeddings in ([[1.0, 0.0]] * 100 + [[1.0]], [[]]):
                count = len(embeddings)
                with self.subTest(cloud=cloud, count=count):
                    with self.assertRaises(EmbeddingDimensionError):
                        repository.add_chunks(
                            "failed",
                            [f"chunk-{i}" for i in range(count)],
                            embeddings,
                            ["test"] * count,
                            [{}] * count,
                        )
            repository.index.upsert.assert_not_called()
            repository.collection.add.assert_not_called()

    def test_mismatched_upload_preserves_real_chroma_data_and_cleans_only_failed_file(
        self,
    ):
        import chromadb
        import numpy as np

        from app.api.v1.endpoints import document

        rag, repository, embedder = self._load_document_pipeline()
        client = chromadb.EphemeralClient(
            settings=chromadb.config.Settings(anonymized_telemetry=False)
        )
        collection = client.create_collection(f"dimension-test-{time.time_ns()}")
        self.addCleanup(client.delete_collection, collection.name)
        repository.collection = collection
        # Two owners' documents share this collection; neither may be reset.
        repository.add_chunks(
            "existing",
            ["alice-chunk", "bob-chunk"],
            [[1.0, 0.0], [0.0, 1.0]],
            ["Alice fixture", "Bob fixture"],
            [
                {"document_id": "document", "embedding_space": "fixture-space"},
                {"document_id": "bob-document", "embedding_space": "fixture-space"},
            ],
        )
        existing = collection.get(include=["documents", "metadatas", "embeddings"])
        embedder.embed_batch.side_effect = lambda texts: [
            [1.0, 0.0, 0.0] for _ in texts
        ]
        with (
            self._isolated_r2() as (objects, storage_client),
            patch.object(document, "rag_service", rag),
            patch.object(
                vectors, "delete_document", side_effect=repository.delete_document
            ),
        ):
            original_objects = dict(objects)
            for filename, content, mime in (
                ("mismatch.txt", b"test", "text/plain"),
                ("mismatch.pdf", self.pdf_fixture("test"), "application/pdf"),
            ):
                response = self.request(
                    "POST",
                    "/document/upload",
                    self.token,
                    data={"session_id": "alice-session"},
                    files={"file": (filename, content, mime)},
                )
                self.assertEqual(response.status_code, 503, response.text)
                self.assertIn("embedding dimensions", response.json()["detail"])
                self.assertIn("preserved", response.json()["detail"])
                self.assertEqual(objects, original_objects)
                current = collection.get(
                    include=["documents", "metadatas", "embeddings"]
                )
                for field in ("ids", "documents", "metadatas"):
                    self.assertEqual(current[field], existing[field])
                np.testing.assert_array_equal(
                    current["embeddings"], existing["embeddings"]
                )
                self.assertEqual(
                    len(
                        repository.similarity_search(
                            [1.0, 0.0],
                            document_ids=["document"],
                            embedding_space="fixture-space",
                        )
                    ),
                    1,
                )
                with database.get_db_connection() as conn:
                    self.assertEqual(
                        conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0], 1
                    )
                    self.assertEqual(
                        conn.execute("SELECT COUNT(*) FROM upload_attempts").fetchone()[
                            0
                        ],
                        0,
                    )
            self.assertEqual(storage_client.delete_object.call_count, 2)
            # Restoring compatible embeddings makes uploads succeed without a reset.
            embedder.embed_batch.side_effect = lambda texts: [[1.0, 0.0] for _ in texts]
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("compatible.txt", b"test", "text/plain")},
            )
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(collection.count(), 3)
            self.assertEqual(storage_client.delete_object.call_count, 2)

    def test_short_txt_and_pdf_upload_through_real_ingestion_and_vector_code(self):
        from app.api.v1.endpoints import document

        rag, repository, embedder = self._load_document_pipeline()
        cases = [
            ("short.txt", b"test", "text/plain", "test"),
            ("short.pdf", self.pdf_fixture("test"), "application/pdf", "test"),
            (
                "regular.txt",
                b"Normal document text for indexing.",
                "text/plain",
                "Normal document text for indexing.",
            ),
        ]
        with patch.object(document, "rag_service", rag):
            for filename, content, mime_type, expected_text in cases:
                with self.subTest(filename=filename):
                    response = self.request(
                        "POST",
                        "/document/upload",
                        self.token,
                        data={"session_id": "alice-session"},
                        files={"file": (filename, content, mime_type)},
                    )
                    self.assertEqual(response.status_code, 201, response.text)
                    uploaded = response.json()["document"]
                    self.assertEqual(uploaded["total_chunks"], 1)
                    self.assertEqual(
                        repository.collection.add.call_args.kwargs["documents"],
                        [expected_text],
                    )
                    self.assertEqual(
                        embedder.embed_batch.call_args.args[0], [expected_text]
                    )
                    self.assertEqual(
                        self.request(
                            "GET", uploaded["storage_url"].removeprefix("/api/v1")
                        ).content,
                        content,
                    )

    def test_chunking_keeps_short_text_and_ignores_only_blank_content(self):
        rag, _, _ = self._load_document_pipeline()
        chunks = rag.recursive_character_chunking([(" \n\t", 1), ("test", 2), ("a", 3)])
        self.assertEqual(
            [
                (chunk["text"], chunk["page_number"], chunk["chunk_index"])
                for chunk in chunks
            ],
            [("test", 2, 0), ("a", 3, 1)],
        )
        self.assertEqual(rag.recursive_character_chunking([(" \n\t", 1)]), [])

    def _exercise_legacy_cleanup_migration(self, *, legacy_index: bool):
        from app.services import session_lifecycle

        requested_at = "2000-01-01T00:00:00"
        completed_at = "2000-01-02T00:00:00"
        with database.get_db_connection(write=True) as conn:
            conn.execute("DROP TABLE session_deletions")
            conn.execute("""CREATE TABLE session_deletions (
                session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                requested_at TEXT NOT NULL, completed_at TEXT
            )""")
            if legacy_index:
                conn.execute(
                    "CREATE INDEX idx_deletions_pending ON session_deletions(completed_at,requested_at)"
                )
            conn.execute(
                "INSERT INTO session_deletions VALUES (?,?,?,NULL)",
                ("alice-session", self.alice.id, requested_at),
            )
            conn.execute(
                "INSERT INTO session_deletions VALUES (?,?,?,?)",
                ("previously-deleted", self.alice.id, requested_at, completed_at),
            )
        database.init_db()
        database.init_db()
        with database.get_db_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM session_deletions ORDER BY session_id"
            ).fetchall()
            self.assertEqual(
                [
                    (
                        row["session_id"],
                        row["user_id"],
                        row["requested_at"],
                        row["completed_at"],
                        row["last_attempt_at"],
                    )
                    for row in rows
                ],
                [
                    ("alice-session", self.alice.id, requested_at, None, 0),
                    (
                        "previously-deleted",
                        self.alice.id,
                        requested_at,
                        completed_at,
                        0,
                    ),
                ],
            )
            index = conn.execute("PRAGMA index_info(idx_deletions_pending)").fetchall()
            self.assertEqual(
                [row["name"] for row in index],
                ["completed_at", "last_attempt_at", "requested_at"],
            )
        self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
        self.assertEqual(session_lifecycle.purge_expired_sessions(), 0)
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 2
        )
        self.assertTrue((settings.UPLOAD_IMAGE_DIR / "fixture.png").exists())
        self.assertTrue((root / "documents/alice-session/fixture.txt").exists())

    def test_legacy_cleanup_schema_migrates_with_existing_pending_index(self):
        self._exercise_legacy_cleanup_migration(legacy_index=True)

    def test_legacy_cleanup_schema_migrates_without_pending_index(self):
        self._exercise_legacy_cleanup_migration(legacy_index=False)

    def test_normal_deletion_preserves_mixed_r2_assets_with_missing_storage_metadata(
        self,
    ):
        from app.services import session_lifecycle
        from app.services.chat_history_service import chat_history_service
        from app.services.media_service import media_service
        from app.services.storage_service import storage_service

        objects = {}
        client = Mock()

        def put_object(**kwargs):
            objects[kwargs["Key"]] = kwargs["Body"]

        def delete_object(**kwargs):
            objects.pop(kwargs["Key"], None)

        client.put_object.side_effect = put_object
        client.delete_object.side_effect = delete_object
        with (
            patch.object(storage_service, "_initialized", True),
            patch.object(storage_service, "_s3_client", client),
            patch.object(
                settings, "CLOUDFLARE_R2_PUBLIC_URL", "https://storage.fixture.invalid"
            ),
        ):
            uploaded = media_service.save_uploaded_media(
                self.image_fixture(), "uploaded.png", "alice-session", self.alice.id
            )
            generated = media_service.save_generated_image(
                self.image_fixture(), "fixture", "alice-session"
            )
            for extension in ("pdf", "txt"):
                key = f"documents/alice-session/review.{extension}"
                content = (
                    self.pdf_fixture("Retention fixture")
                    if extension == "pdf"
                    else b"fixture"
                )
                url, _ = storage_service.upload_file(
                    content, key, session_id="alice-session"
                )
                chat_history_service.save_document(
                    "review-" + extension,
                    self.alice.id,
                    "alice-session",
                    "review." + extension,
                    extension,
                    len(content),
                    1,
                    url,
                )
            # An external write can finish before its SQL metadata is registered.
            unknown_key = "media/uploads/unregistered-fixture.png"
            storage_service.upload_file(
                self.image_fixture(), unknown_key, session_id="alice-session"
            )
            with database.get_db_connection(write=True) as conn:
                conn.execute(
                    "UPDATE documents SET storage_url='' WHERE id='review-pdf'"
                )
                conn.execute(
                    "UPDATE media_assets SET user_id='' WHERE id=?", (generated.id,)
                )
            original_objects = dict(objects)
            self.assertEqual(
                self.request(
                    "DELETE", "/session/alice-session", self.token
                ).status_code,
                200,
            )
            self.assertEqual(objects, original_objects)
            client.delete_object.assert_not_called()
            library = self.request("GET", "/media/assets", self.token).json()
            self.assertEqual(
                {item["id"] for item in library["items"]},
                {
                    "image",
                    "document",
                    uploaded.id,
                    generated.id,
                    "review-pdf",
                    "review-txt",
                },
            )
            for asset_id, kind in (
                (uploaded.id, "media"),
                (generated.id, "media"),
                ("review-pdf", "document"),
                ("review-txt", "document"),
            ):
                assert asset_id is not None
                row = security.check_asset(asset_id, self.principal, kind)
                self.assertIsNone(row["session_id"])
                self.assertEqual(row["user_id"], self.alice.id)
            self.assertEqual(session_lifecycle.purge_expired_sessions(), 0)
            self.assertEqual(objects, original_objects)
            client.delete_object.assert_not_called()
        with database.get_db_connection() as conn:
            # Keep uncertain object ownership available for separately reviewed recovery.
            self.assertIsNotNone(
                conn.execute(
                    "SELECT 1 FROM session_resources WHERE session_id='alice-session' AND kind='r2' AND resource_key=?",
                    (unknown_key,),
                ).fetchone()
            )

    def test_normal_assets_stay_visible_when_scratch_cleanup_fails_and_retries(self):
        from app.services import session_lifecycle
        from app.services.storage_service import storage_service

        scratch = settings.UPLOAD_DIR / "normal-pending-scratch.txt"
        scratch.write_bytes(b"fixture")
        session_lifecycle.register_resource(
            "alice-session", "local", "uploads/normal-pending-scratch.txt"
        )
        with patch.object(
            storage_service,
            "delete_owned_file",
            side_effect=OSError("fixture busy file"),
        ) as delete:
            self.assertEqual(
                self.request(
                    "DELETE", "/session/alice-session", self.token
                ).status_code,
                200,
            )
            delete.assert_called_once_with(
                "uploads/normal-pending-scratch.txt", backend="local"
            )
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 2
        )
        self.assertEqual(
            self.request("GET", "/media/assets", self.other_token).json()["total"], 0
        )
        with database.get_db_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT completed_at FROM session_deletions").fetchone()[0]
            )
        self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
        self.assertEqual(session_lifecycle.purge_expired_sessions(), 0)
        self.assertFalse(scratch.exists())
        self.assertTrue((settings.UPLOAD_IMAGE_DIR / "fixture.png").exists())
        self.assertTrue((root / "documents/alice-session/fixture.txt").exists())
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 2
        )

    def test_normal_assets_stay_visible_while_an_external_write_finishes(self):
        from app.services import session_lifecycle
        from app.services.storage_service import storage_service

        with session_lifecycle.resource_operation("alice-session"):
            session_lifecycle.register_resource(
                "alice-session", "r2", "media/uploads/inflight-fixture.png"
            )
            self.assertEqual(
                self.request(
                    "DELETE", "/session/alice-session", self.token
                ).status_code,
                200,
            )
            self.assertEqual(
                self.request("GET", "/media/assets", self.token).json()["total"], 2
            )
            with database.get_db_connection() as conn:
                self.assertIsNone(
                    conn.execute(
                        "SELECT completed_at FROM session_deletions"
                    ).fetchone()[0]
                )
        with patch.object(storage_service, "delete_owned_file") as delete:
            self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
            delete.assert_not_called()
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 2
        )

    def test_retry_repairs_previous_pending_normal_deletion_without_r2_access(self):
        from app.services import session_lifecycle
        from app.services.storage_service import storage_service

        session_lifecycle.register_resource(
            "alice-session", "r2", "media/uploads/unknown-fixture.png"
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE documents SET storage_url='https://old-storage.fixture.invalid/file.txt' WHERE id='document'"
            )
            conn.execute(
                "INSERT INTO session_deletions (session_id,user_id,requested_at) VALUES (?,?,?)",
                ("alice-session", self.alice.id, session_lifecycle.utc_now()),
            )
        database.init_db()
        with patch.object(storage_service, "delete_owned_file") as delete:
            self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
            delete.assert_not_called()
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 2
        )

    def test_normal_deletion_preserves_unregistered_uploads_but_cleans_scratch(self):
        from app.services import session_lifecycle
        from app.services.storage_service import storage_service

        key = "media/uploads/unregistered-local.png"
        storage_service.upload_file(
            self.image_fixture(), key, session_id="alice-session"
        )
        scratch = settings.UPLOAD_DIR / "normal-scratch.txt"
        scratch.write_bytes(b"fixture")
        session_lifecycle.register_resource(
            "alice-session", "local", "uploads/normal-scratch.txt"
        )
        self.assertTrue(session_lifecycle.request_deletion("alice-session"))
        self.assertTrue((root / key).exists())
        self.assertFalse(scratch.exists())
        self.assertEqual(session_lifecycle.purge_expired_sessions(), 0)

    def test_normal_chat_deletion_preserves_library_and_document_vectors(self):
        from app.repositories.session_store import session_store_repo
        from app.services.chat_history_service import chat_history_service
        from app.services.session_lifecycle import register_resource

        chat_history_service.save_message("alice-session", "user", "Disposable message")
        session_store_repo.get_or_create_session("alice-session")
        security.ensure_session("other-chat", self.principal)
        other_chat = session_store_repo.get_or_create_session("other-chat")
        other_chat.document_ids.append("document")
        register_resource("alice-session", "vector", "document")
        for kind in ("local", "r2"):
            register_resource("alice-session", kind, "media/uploads/fixture.png")
            register_resource(
                "alice-session", kind, "documents/alice-session/fixture.txt"
            )
        # Older generated assets can have only a session owner.
        with database.get_db_connection(write=True) as conn:
            conn.execute("UPDATE media_assets SET user_id=NULL WHERE id='image'")
        with patch.object(vectors, "delete_document") as delete_vectors:
            response = self.request("DELETE", "/session/alice-session", self.token)
            self.assertEqual(response.status_code, 200)
            delete_vectors.assert_not_called()
        for asset_id, kind in (("image", "media"), ("document", "document")):
            row = security.check_asset(asset_id, self.principal, kind)
            self.assertIsNone(row["session_id"])
            self.assertEqual(row["user_id"], self.alice.id)
        self.assertTrue((settings.UPLOAD_IMAGE_DIR / "fixture.png").exists())
        self.assertTrue((root / "documents/alice-session/fixture.txt").exists())
        self.assertIsNotNone(session_store_repo.get_document_metadata("document"))
        self.assertNotIn("alice-session", session_store_repo._sessions)
        self.assertIn("document", other_chat.document_ids)
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 2
        )
        with database.get_db_connection() as conn:
            self.assertIsNone(
                conn.execute(
                    "SELECT 1 FROM messages WHERE session_id='alice-session'"
                ).fetchone()
            )
        self.assertEqual(
            self.request("GET", "/media/assets", self.other_token).json()["total"], 0
        )

    def test_temporary_deletion_removes_files_vectors_sql_and_cache(self):
        from app.repositories.session_store import session_store_repo
        from app.services.chat_history_service import chat_history_service

        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE chat_sessions SET is_temporary=1 WHERE id='alice-session'"
            )
        session_store_repo.get_or_create_session("alice-session")
        chat_history_service.save_message("alice-session", "user", "Temporary message")
        security.download_url("image", self.principal)
        security.download_url("document", self.principal, "document")
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 0
        )
        with patch.object(vectors, "delete_document") as delete_vectors:
            self.assertEqual(
                self.request(
                    "DELETE", "/session/alice-session", self.token
                ).status_code,
                200,
            )
            delete_vectors.assert_called_once_with("document", raise_on_error=True)
        self.assertFalse((settings.UPLOAD_IMAGE_DIR / "fixture.png").exists())
        self.assertFalse((root / "documents/alice-session/fixture.txt").exists())
        self.assertNotIn("alice-session", session_store_repo._sessions)
        self.assertNotIn("document", session_store_repo._documents)
        with database.get_db_connection() as conn:
            for table in (
                "chat_sessions",
                "messages",
                "documents",
                "media_assets",
                "session_resources",
                "download_tickets",
            ):
                self.assertEqual(
                    conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0
                )

    def test_deleted_chat_cannot_be_recreated_or_receive_late_writes(self):
        from fastapi import HTTPException

        from app.repositories.session_store import session_store_repo
        from app.services.chat_history_service import chat_history_service
        from app.services.media_service import media_service

        self.assertEqual(
            self.request("DELETE", "/session/alice-session", self.token).status_code,
            200,
        )
        for operation in (
            lambda: security.ensure_session("alice-session", self.principal),
            lambda: chat_history_service.create_session(self.alice.id, "alice-session"),
            lambda: chat_history_service.save_message(
                "alice-session", "assistant", "late response"
            ),
            lambda: session_store_repo.record_message(
                "alice-session", "assistant", "late response"
            ),
            lambda: media_service.save_uploaded_media(
                self.image_fixture(), "late.png", "alice-session", self.alice.id
            ),
        ):
            with self.assertRaises(HTTPException) as caught:
                operation()
            self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(
            self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={"session_id": "alice-session", "message": "late"},
            ).status_code,
            404,
        )

    def test_failed_temporary_cleanup_is_hidden_and_retried_after_restart(self):
        from app.repositories.session_store import session_store_repo
        from app.services import session_lifecycle

        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE chat_sessions SET is_temporary=1 WHERE id='alice-session'"
            )
        with patch.object(
            vectors, "delete_document", side_effect=RuntimeError("fixture outage")
        ):
            self.assertEqual(
                self.request(
                    "DELETE", "/session/alice-session", self.token
                ).status_code,
                200,
            )
        self.assertEqual(
            self.request(
                "GET", "/session/alice-session/history", self.token
            ).status_code,
            404,
        )
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 0
        )
        with database.get_db_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT completed_at FROM session_deletions").fetchone()[0]
            )
            self.assertGreater(
                conn.execute("SELECT COUNT(*) FROM session_resources").fetchone()[0], 0
            )
        session_store_repo._sessions.clear()
        session_store_repo._documents.clear()
        database.init_db()  # Existing intents survive startup/migration.
        with patch.object(vectors, "delete_document"):
            self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
            self.assertEqual(session_lifecycle.purge_expired_sessions(), 0)
        with database.get_db_connection() as conn:
            self.assertIsNotNone(
                conn.execute("SELECT completed_at FROM session_deletions").fetchone()[0]
            )

    def test_expiry_cleans_temporary_files_but_preserves_other_chat_library(self):
        from app.schemas.chat import MediaAttachment
        from app.services import session_lifecycle
        from app.services.chat_history_service import chat_history_service

        security.ensure_session("expires", self.principal, is_temporary=True)
        chat_history_service.save_message(
            "expires",
            "user",
            "Review",
            attachments=[MediaAttachment(id="document", file_type="document")],
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE media_assets SET session_id='expires' WHERE id='image'"
            )
            conn.execute(
                "UPDATE chat_sessions SET expires_at='2000-01-01T00:00:00' WHERE id='expires'"
            )
        with patch.object(vectors, "delete_document") as delete_vectors:
            self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
            delete_vectors.assert_not_called()
        self.assertFalse((settings.UPLOAD_IMAGE_DIR / "fixture.png").exists())
        self.assertTrue((root / "documents/alice-session/fixture.txt").exists())
        security.check_asset("document", self.principal, "document")
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM session_documents").fetchone()[0], 0
            )

    def test_cleanup_waits_for_inflight_external_writes(self):
        import threading

        from app.services import session_lifecycle

        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE chat_sessions SET is_temporary=1 WHERE id='alice-session'"
            )
        ready, finish = threading.Event(), threading.Event()
        late_file = root / "media/uploads/late-write.png"

        def upload():
            with session_lifecycle.resource_operation("alice-session"):
                session_lifecycle.register_resource(
                    "alice-session", "local", "media/uploads/late-write.png"
                )
                ready.set()
                if not finish.wait(10):
                    raise AssertionError("Test did not release upload")
                late_file.write_bytes(b"fixture")

        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(upload)
            try:
                self.assertTrue(ready.wait(10))
                self.assertTrue(session_lifecycle.request_deletion("alice-session"))
                with database.get_db_connection() as conn:
                    self.assertIsNone(
                        conn.execute(
                            "SELECT completed_at FROM session_deletions"
                        ).fetchone()[0]
                    )
            finally:
                finish.set()
            pending.result(timeout=10)
        self.assertTrue(late_file.exists())
        self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
        self.assertFalse(late_file.exists())

    def test_crashed_upload_resources_and_expired_leases_are_cleaned(self):
        from app.services import session_lifecycle

        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE chat_sessions SET is_temporary=1 WHERE id='alice-session'"
            )
        orphan = root / "media/uploads/orphan.png"
        orphan.write_bytes(b"fixture")
        scratch = settings.UPLOAD_DIR / "crashed-scratch.txt"
        scratch.write_bytes(b"fixture")
        session_lifecycle.register_resource(
            "alice-session", "local", "media/uploads/orphan.png"
        )
        session_lifecycle.register_resource(
            "alice-session", "local", "uploads/crashed-scratch.txt"
        )
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "INSERT INTO session_operations VALUES ('crashed','alice-session',0)"
            )
        self.assertTrue(session_lifecycle.request_deletion("alice-session"))
        self.assertFalse(orphan.exists())
        self.assertFalse(scratch.exists())
        self.assertFalse((settings.UPLOAD_IMAGE_DIR / "fixture.png").exists())

    def test_r2_cleanup_failure_keeps_retry_intent_and_deletes_local_fallback(self):
        from app.services import session_lifecycle
        from app.services.storage_service import storage_service

        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE chat_sessions SET is_temporary=1 WHERE id='alice-session'"
            )
        client = Mock()
        client.delete_object.side_effect = RuntimeError("fixture R2 unavailable")
        with (
            patch.object(storage_service, "_initialized", True),
            patch.object(storage_service, "_s3_client", client),
        ):
            self.assertTrue(session_lifecycle.request_deletion("alice-session"))
            with database.get_db_connection() as conn:
                self.assertGreater(
                    conn.execute(
                        "SELECT COUNT(*) FROM session_resources WHERE kind='r2'"
                    ).fetchone()[0],
                    0,
                )
            client.delete_object.side_effect = None
            self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
        self.assertFalse((settings.UPLOAD_IMAGE_DIR / "fixture.png").exists())
        self.assertFalse((root / "documents/alice-session/fixture.txt").exists())
        keys = {call.kwargs["Key"] for call in client.delete_object.call_args_list}
        self.assertEqual(
            keys, {"media/uploads/fixture.png", "documents/alice-session/fixture.txt"}
        )

    def test_selected_r2_initialization_failure_never_falls_back_to_local_disk(self):
        import app.services.storage_service as storage_module

        with patch.multiple(
            settings,
            create=True,
            is_cloudflare_r2_configured=True,
            r2_endpoint_url="https://fixture.invalid",
            CLOUDFLARE_R2_ACCESS_KEY_ID="fixture",
            CLOUDFLARE_R2_SECRET_ACCESS_KEY="fixture",
        ):
            with patch.object(storage_module, "BOTO3_AVAILABLE", False):
                with self.assertRaisesRegex(RuntimeError, "boto3"):
                    storage_module.StorageService()
            with patch.object(
                storage_module.boto3,
                "client",
                side_effect=ValueError("private-provider-detail"),
            ):
                with self.assertRaises(RuntimeError) as error:
                    storage_module.StorageService()
                self.assertNotIn("private-provider-detail", str(error.exception))
        with patch.object(settings, "is_cloudflare_r2_configured", False):
            with patch.object(storage_module, "BOTO3_AVAILABLE", False):
                self.assertFalse(storage_module.StorageService().is_r2_active)

    def test_missing_r2_configuration_does_not_discard_cleanup_intent(self):
        from app.services import session_lifecycle
        from app.services.storage_service import storage_service

        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE chat_sessions SET is_temporary=1 WHERE id='alice-session'"
            )
        session_lifecycle.register_resource(
            "alice-session", "r2", "media/uploads/cloud-only.png"
        )
        self.assertTrue(session_lifecycle.request_deletion("alice-session"))
        with database.get_db_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT completed_at FROM session_deletions").fetchone()[0]
            )
        client = Mock()
        with (
            patch.object(storage_service, "_initialized", True),
            patch.object(storage_service, "_s3_client", client),
        ):
            self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)

    def test_guest_upload_without_chat_gets_expiry_and_never_enters_library(self):
        from app.services import session_lifecycle

        guest = security.create_guest()
        response = self.request(
            "POST",
            "/media/upload",
            guest["access_token"],
            files={"file": ("guest.png", self.image_fixture(), "image/png")},
        )
        self.assertEqual(response.status_code, 201)
        with database.get_db_connection(write=True) as conn:
            row = conn.execute(
                "SELECT session_id,file_path FROM media_assets WHERE id=?",
                (response.json()["id"],),
            ).fetchone()
            self.assertIsNotNone(row["session_id"])
            session = conn.execute(
                "SELECT is_temporary,expires_at FROM chat_sessions WHERE id=?",
                (row["session_id"],),
            ).fetchone()
            self.assertEqual(session["is_temporary"], 1)
            self.assertTrue(session["expires_at"])
            conn.execute(
                "UPDATE chat_sessions SET expires_at='2000-01-01' WHERE id=?",
                (row["session_id"],),
            )
        self.assertEqual(
            self.request("GET", "/media/assets", guest["access_token"]).json()["total"],
            0,
        )
        self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
        self.assertFalse((root / row["file_path"]).exists())

    def test_temporary_fallback_requests_preserve_retention(self):
        response = self.request(
            "POST",
            "/chat/stream",
            self.token,
            json={
                "session_id": "temp-fallback",
                "message": "fixture",
                "is_temporary": True,
            },
        )
        self.assertEqual(response.status_code, 200)
        response = self.request(
            "POST",
            "/media/upload",
            self.token,
            data={"session_id": "upload-fallback", "is_temporary": "true"},
            files={"file": ("fixture.png", self.image_fixture(), "image/png")},
        )
        self.assertEqual(response.status_code, 201)
        with database.get_db_connection() as conn:
            for session_id in ("temp-fallback", "upload-fallback"):
                row = conn.execute(
                    "SELECT is_temporary,expires_at FROM chat_sessions WHERE id=?",
                    (session_id,),
                ).fetchone()
                self.assertEqual(row["is_temporary"], 1)
                self.assertTrue(row["expires_at"])

    def test_legacy_document_migration_preserves_rows_and_is_repeatable(self):
        with database.get_db_connection(write=True) as conn:
            conn.execute("""CREATE TABLE legacy_documents (
                id TEXT PRIMARY KEY,user_id TEXT,session_id TEXT NOT NULL,
                filename TEXT NOT NULL,file_type TEXT NOT NULL,file_size_bytes INTEGER NOT NULL,
                total_chunks INTEGER NOT NULL,storage_url TEXT DEFAULT '',created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE)""")
            conn.execute(
                "INSERT INTO legacy_documents SELECT id,user_id,session_id,filename,file_type,file_size_bytes,total_chunks,storage_url,created_at FROM documents"
            )
            conn.execute("DROP TABLE documents")
            conn.execute("ALTER TABLE legacy_documents RENAME TO documents")
        database.init_db()
        database.init_db()
        with database.get_db_connection(write=True) as conn:
            row = conn.execute("SELECT * FROM documents WHERE id='document'").fetchone()
            self.assertEqual(row["filename"], "fixture.txt")
            columns = conn.execute("PRAGMA table_info(documents)").fetchall()
            self.assertEqual(
                next(row["notnull"] for row in columns if row["name"] == "session_id"),
                0,
            )
            conn.execute("UPDATE documents SET session_id=NULL WHERE id='document'")

    def test_object_deletion_rejects_paths_outside_owned_storage(self):
        from app.services.storage_service import storage_service

        target = root / "keep.txt"
        target.write_bytes(b"fixture")
        for key in (
            str(target),
            "../keep.txt",
            "media/../../keep.txt",
            "https://other.invalid/media/uploads/fixture.png",
        ):
            self.assertFalse(storage_service.delete_file(key))
        self.assertTrue(target.exists())
        self.assertTrue(
            storage_service.delete_file("media/uploads/already-missing.png")
        )

    def test_other_worker_cache_is_pruned_without_deleting_live_library_metadata(self):
        from app.repositories.session_store import session_store_repo
        from app.schemas.chat import SessionState
        from app.services import session_lifecycle

        stale = SessionState(
            session_id="removed-by-other-worker",
            mode="AUTO",
            document_ids=[],
            created_at="2000-01-01T00:00:00",
        )
        session_store_repo._sessions[stale.session_id] = stale
        metadata = session_store_repo.get_document_metadata("document")
        assert metadata is not None
        session_store_repo._documents["stale-document"] = metadata
        session_store_repo.get_or_create_session("alice-session")
        session_lifecycle.prune_local_cache()
        self.assertNotIn(stale.session_id, session_store_repo._sessions)
        self.assertNotIn("stale-document", session_store_repo._documents)
        self.assertIn("alice-session", session_store_repo._sessions)
        self.assertIn("document", session_store_repo._documents)

    def test_vector_deletion_surfaces_provider_failures_for_cleanup_retries(self):
        chroma = types.ModuleType("chromadb")
        setattr(chroma, "PersistentClient", Mock())
        with (
            patch.dict(sys.modules, {"chromadb": chroma}),
            patch.multiple(
                settings, VECTOR_STORE_TYPE="chroma", PINECONE_API_KEY="", create=True
            ),
        ):
            repository = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1]
                    / "app/repositories/vector_store.py"
                )
            )["vector_store_repo"]
        repository.index = Mock()
        for cloud in (False, True):
            repository.use_pinecone = cloud
            provider = repository.index if cloud else repository.collection
            provider.delete.side_effect = RuntimeError("fixture provider failure")
            with self.assertRaises(RuntimeError):
                repository.delete_document("owned-document", raise_on_error=True)
            provider.delete.side_effect = None
            repository.delete_document("owned-document", raise_on_error=True)
            provider.delete.assert_called_with(
                **(
                    {"filter": {"document_id": {"$eq": "owned-document"}}}
                    if cloud
                    else {"where": {"document_id": "owned-document"}}
                )
            )

    def test_document_migration_failure_rolls_back_without_losing_original_rows(self):
        from contextlib import contextmanager

        with database.get_db_connection(write=True) as conn:
            conn.execute("""CREATE TABLE legacy_documents (
                id TEXT PRIMARY KEY,user_id TEXT,session_id TEXT NOT NULL,
                filename TEXT NOT NULL,file_type TEXT NOT NULL,file_size_bytes INTEGER NOT NULL,
                total_chunks INTEGER NOT NULL,storage_url TEXT DEFAULT '',created_at TEXT NOT NULL)""")
            conn.execute(
                "INSERT INTO legacy_documents SELECT id,user_id,session_id,filename,file_type,file_size_bytes,total_chunks,storage_url,created_at FROM documents"
            )
            conn.execute("DROP TABLE documents")
            conn.execute("ALTER TABLE legacy_documents RENAME TO documents")
        original = database.get_db_connection

        class FailingCursor:
            def __init__(self, cursor):
                self.cursor = cursor

            def execute(self, sql, *args):
                if sql == "ALTER TABLE documents_retained RENAME TO documents":
                    raise RuntimeError(
                        "fixture migration failure after original table drop"
                    )
                return self.cursor.execute(sql, *args)

            def __getattr__(self, name):
                return getattr(self.cursor, name)

        class Connection:
            def __init__(self, connection):
                self.connection = connection

            def cursor(self):
                return FailingCursor(self.connection.cursor())

            def __getattr__(self, name):
                return getattr(self.connection, name)

        @contextmanager
        def failed_migration(**kwargs):
            with original(**kwargs) as conn:
                yield Connection(conn)

        with (
            patch.object(database, "get_db_connection", failed_migration),
            self.assertRaises(RuntimeError),
        ):
            database.init_db()
        with original() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT filename FROM documents WHERE id='document'"
                ).fetchone()[0],
                "fixture.txt",
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT name FROM sqlite_master WHERE name='documents_retained'"
                ).fetchone()
            )
        database.init_db()

    def image_fixture(self, image_format="PNG", animated=False):
        from PIL import Image

        image = Image.new("RGB", (8, 8), "red")
        output = io.BytesIO()
        if animated:
            image.save(
                output,
                format=image_format,
                save_all=True,
                append_images=[Image.new("RGB", (8, 8), "blue")],
                duration=50,
                loop=0,
            )
        else:
            image.save(output, format=image_format)
        return output.getvalue()

    def pdf_fixture(self, *texts, encrypted=False):
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

        writer = PdfWriter()
        for text in texts:
            page = writer.add_blank_page(width=612, height=792)
            font = DictionaryObject(
                {
                    NameObject("/Type"): NameObject("/Font"),
                    NameObject("/Subtype"): NameObject("/Type1"),
                    NameObject("/BaseFont"): NameObject("/Helvetica"),
                }
            )
            page[NameObject("/Resources")] = DictionaryObject(
                {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
            )
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
        database.DB_FILE = root / (
            self.__class__.__name__ + self._testMethodName + ".db"
        )
        database.init_db()
        self.alice = user_service.register_user(
            UserRegisterRequest(
                username="alice",
                email="alice@example.invalid",
                display_name="First Person",
                password="Durable!482Strong",
            )
        )
        self.bob = user_service.register_user(
            UserRegisterRequest(
                username="bobby",
                email="bobby@example.invalid",
                display_name="Second Person",
                password="Durable!482Strong",
            )
        )
        self.token = security.issue_credentials(self.alice.id)["access_token"]
        self.other_token = security.issue_credentials(self.bob.id)["access_token"]
        self.principal = security.resolve_principal(security.digest(self.token))
        security.ensure_session("alice-session", self.principal)
        with database.get_db_connection() as conn:
            conn.execute(
                "INSERT INTO media_assets (id,user_id,session_id,filename,file_path,file_url,mime_type,created_at) "
                "VALUES ('image',?,'alice-session','fixture.png','media/uploads/fixture.png','/api/v1/media/uploads/fixture.png','image/png',?)",
                (
                    self.alice.id,
                    datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
                ),
            )
            conn.execute(
                "INSERT INTO documents (id,user_id,session_id,filename,file_type,file_size_bytes,total_chunks,storage_url,created_at) "
                "VALUES ('document',?,'alice-session','fixture.txt','txt',7,1,'/api/v1/media/documents/alice-session/fixture.txt',?)",
                (
                    self.alice.id,
                    datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
                ),
            )
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE documents SET embedding_space='fixture-space' WHERE id='document'"
            )
        (settings.UPLOAD_IMAGE_DIR / "fixture.png").write_bytes(b"fixture-image")
        directory = root / "documents/alice-session"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "fixture.txt").write_bytes(b"fixture")

    def request(self, method, path, token=None, **kwargs):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://fixture.invalid",
            ) as client:
                return await client.request(
                    method,
                    "/api/v1" + path,
                    headers={"Authorization": "Bearer " + token} if token else {},
                    **kwargs,
                )

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

            with (
                patch.object(main, "init_db") as initialize,
                patch.object(
                    main.chat_history_service, "purge_expired_temporary_sessions"
                ) as purge,
                patch.object(main, "_periodic_temporary_cleanup", cleanup),
                patch.object(
                    main.image_gen_service, "aclose", new_callable=AsyncMock
                ) as close_images,
            ):
                async with app.router.lifespan_context(app):
                    await asyncio.wait_for(started.wait(), timeout=1)
                    initialize.assert_called_once_with()
                    purge.assert_called_once_with()
                self.assertTrue(stopped.is_set())
                close_images.assert_awaited_once()

        asyncio.run(exercise())

    def test_anonymous_resource_matrix(self):
        cases = [
            ("GET", "/user/me", {}),
            ("PATCH", "/user/profile", {"json": {"user_id": self.alice.id}}),
            ("GET", "/user/avatar/" + self.alice.id, {}),
            ("GET", "/session/list?user_id=" + self.alice.id, {}),
            ("POST", "/session/create", {"json": {"user_id": self.alice.id}}),
            ("GET", "/session/alice-session/history", {}),
            ("PATCH", "/session/alice-session/title", {"json": {"title": "Changed"}}),
            ("PATCH", "/session/alice-session/pin", {"json": {"is_pinned": True}}),
            ("PATCH", "/session/alice-session/mode", {"json": {"mode": "AUTO"}}),
            ("DELETE", "/session/alice-session/messages", {}),
            ("DELETE", "/session/alice-session", {}),
            ("GET", "/document/list?session_id=alice-session", {}),
            ("GET", "/document/document/chunks", {}),
            ("DELETE", "/document/document?session_id=alice-session", {}),
            ("GET", "/media/assets", {}),
            ("GET", "/media/session/alice-session", {}),
            ("DELETE", "/media/assets/image", {}),
            ("GET", "/media/content/media/image", {}),
            (
                "POST",
                "/chat/stream",
                {"json": {"session_id": "alice-session", "message": "hello"}},
            ),
            (
                "POST",
                "/document/upload",
                {
                    "data": {"session_id": "alice-session"},
                    "files": {"file": ("fixture.txt", b"fixture")},
                },
            ),
            (
                "POST",
                "/media/upload",
                {"files": {"file": ("fixture.png", b"fixture", "image/png")}},
            ),
            (
                "POST",
                "/user/avatar",
                {
                    "data": {"user_id": self.alice.id},
                    "files": {"file": ("fixture.png", b"fixture", "image/png")},
                },
            ),
            ("DELETE", "/user/avatar?user_id=" + self.alice.id, {}),
            (
                "POST",
                "/user/change-password",
                {
                    "json": {
                        "user_id": self.alice.id,
                        "old_password": "Durable!482Strong",
                        "new_password": "Another!482Strong",
                    }
                },
            ),
        ]
        for method, path, kwargs in cases:
            with self.subTest(path=path):
                self.assertEqual(self.request(method, path, **kwargs).status_code, 401)

    def test_cross_user_matrix(self):
        cases = [
            ("GET", "/session/alice-session/history", {}),
            ("PATCH", "/session/alice-session/title", {"json": {"title": "Changed"}}),
            ("DELETE", "/session/alice-session", {}),
            ("GET", "/document/document/chunks", {}),
            ("DELETE", "/document/document?session_id=alice-session", {}),
            ("DELETE", "/media/assets/image", {}),
            ("GET", "/media/content/media/image", {}),
            ("GET", "/media/assets?session_id=alice-session", {}),
            ("GET", "/user/me?user_id=" + self.alice.id, {}),
            (
                "POST",
                "/session/create",
                {"json": {"session_id": "alice-session", "user_id": self.bob.id}},
            ),
            (
                "POST",
                "/chat/stream",
                {"json": {"session_id": "alice-session", "message": "hello"}},
            ),
        ]
        for method, path, kwargs in cases:
            with self.subTest(path=path):
                self.assertIn(
                    self.request(method, path, self.other_token, **kwargs).status_code,
                    (403, 404),
                )

    def test_owned_reads_and_default_library_are_scoped(self):
        for path in (
            "/user/me",
            "/session/alice-session/history",
            "/document/document/chunks",
            "/media/session/alice-session",
        ):
            self.assertEqual(self.request("GET", path, self.token).status_code, 200)
        self.assertEqual(
            self.request("GET", "/media/assets", self.other_token).json()["total"], 0
        )
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 2
        )

    def test_media_owner_for_uploads_and_both_generation_paths_is_server_derived(self):
        from app.api.v1.endpoints import chat
        from app.services.media_service import media_service

        image_bytes = self.image_fixture()
        ids = []
        # Web and native requests may omit the optional user_id claim.
        for claim in ({}, {"user_id": self.alice.id}):
            response = self.request(
                "POST",
                "/media/upload",
                self.token,
                data={"session_id": "alice-session", **claim},
                files={"file": ("uploaded.png", image_bytes, "image/png")},
            )
            self.assertEqual(response.status_code, 201, response.text)
            ids.append(response.json()["id"])

        async def generate(**kwargs):
            # The orchestrator intentionally supplies only the session ID.
            attachment = media_service.save_generated_image(
                image_bytes, kwargs["prompt"], session_id=kwargs["session_id"]
            )
            ids.append(attachment.id)
            return attachment

        providers = {}
        for name in ("llm_service", "image_gen_service", "web_search_service"):
            stub = types.ModuleType("app.services." + name)
            setattr(stub, name, Mock())
            providers[stub.__name__] = stub
        generator = providers["app.services.image_gen_service"].image_gen_service
        generator.generate_image = AsyncMock(side_effect=generate)
        generator.generate_from_reference = AsyncMock(side_effect=generate)
        with patch.dict(sys.modules, providers):
            actual = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"
                )
            )["chat_orchestrator"]
        with patch.object(chat, "chat_orchestrator", actual):
            for attachments in ([], [{"id": ids[0], "file_type": "image"}]):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "alice-session",
                        "mode": "IMAGE_GENERATION",
                        "message": "Generate an image of a tree",
                        "attachments": attachments,
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertNotIn('"event": "error"', response.text)
        generator.generate_image.assert_awaited_once()
        generator.generate_from_reference.assert_awaited_once()
        with database.get_db_connection() as conn:
            for asset_id in ids:
                row = conn.execute(
                    "SELECT user_id FROM media_assets WHERE id=?", (asset_id,)
                ).fetchone()
                self.assertEqual(row["user_id"], self.alice.id)
        for origin, expected in (("upload", set(ids[:2])), ("generated", set(ids[2:]))):
            response = self.request(
                "GET", "/media/assets", self.token, params={"origin": origin}
            )
            self.assertEqual(response.status_code, 200, response.text)
            items = response.json()["items"]
            self.assertTrue(expected.issubset({item["id"] for item in items}))
            self.assertTrue(all(item["user_id"] == self.alice.id for item in items))
        self.assertEqual(
            self.request("GET", "/media/assets", self.other_token).json()["total"], 0
        )

    def test_media_owner_conflict_cannot_publish_an_asset(self):
        from fastapi import HTTPException

        from app.services.media_service import media_service

        for generated in (False, True):
            with self.assertRaises(HTTPException) as error:
                if generated:
                    media_service.save_generated_image(
                        self.image_fixture(), "fixture", "alice-session", self.bob.id
                    )
                else:
                    media_service.save_uploaded_media(
                        self.image_fixture(),
                        "fixture.png",
                        "alice-session",
                        self.bob.id,
                    )
            self.assertEqual(error.exception.status_code, 403)
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0], 1
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM upload_resources").fetchone()[0], 0
            )

    def test_media_owner_keeps_guest_and_temporary_generations_out_of_library(self):
        from app.services.media_service import media_service

        guest = security.create_guest()
        principal = security.resolve_principal(security.digest(guest["access_token"]))
        security.ensure_session("guest-images", principal)
        security.ensure_session("temporary-images", self.principal, is_temporary=True)
        for session_id, expected_owner in (
            ("guest-images", principal.user_id),
            ("temporary-images", self.alice.id),
        ):
            attachment = media_service.save_generated_image(
                self.image_fixture(), "fixture", session_id=session_id
            )
            with database.get_db_connection() as conn:
                self.assertEqual(
                    conn.execute(
                        "SELECT user_id FROM media_assets WHERE id=?", (attachment.id,)
                    ).fetchone()[0],
                    expected_owner,
                )
            self.assertNotIn(
                attachment.id,
                {
                    item["id"]
                    for item in self.request("GET", "/media/assets", self.token).json()[
                        "items"
                    ]
                },
            )
        self.assertEqual(
            self.request("GET", "/media/assets", guest["access_token"]).json()["total"],
            0,
        )

    def test_media_owner_legacy_fallback_handles_null_and_empty_without_reassigning(
        self,
    ):
        for legacy_owner in (None, ""):
            with database.get_db_connection() as conn:
                conn.execute(
                    "UPDATE media_assets SET user_id=? WHERE id='image'",
                    (legacy_owner,),
                )
                conn.execute(
                    "UPDATE documents SET user_id=? WHERE id='document'",
                    (legacy_owner,),
                )
            response = self.request("GET", "/media/assets", self.token)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["total"], 2)
            self.assertTrue(
                all(
                    item["user_id"] == self.alice.id
                    for item in response.json()["items"]
                )
            )
            self.assertEqual(
                self.request("GET", "/media/assets", self.other_token).json()["total"],
                0,
            )
            with database.get_db_connection() as conn:
                self.assertEqual(
                    conn.execute(
                        "SELECT user_id FROM media_assets WHERE id='image'"
                    ).fetchone()[0],
                    legacy_owner,
                )
        with database.get_db_connection() as conn:
            conn.execute("UPDATE media_assets SET session_id=NULL WHERE id='image'")
            conn.execute("UPDATE documents SET session_id=NULL WHERE id='document'")
        self.assertEqual(
            self.request("GET", "/media/assets", self.token).json()["total"], 0
        )

    def test_forged_and_expired_credentials(self):
        self.assertEqual(self.request("GET", "/user/me", "forged").status_code, 401)
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE auth_sessions SET expires_at=0 WHERE token_hash=?",
                (self.principal.token_hash,),
            )
        self.assertEqual(self.request("GET", "/user/me", self.token).status_code, 401)

    def test_logout_revokes_download_and_api_credentials(self):
        url = security.download_url("image", self.principal)
        self.assertEqual(
            self.request("GET", url.removeprefix("/api/v1")).content, b"fixture-image"
        )
        self.assertEqual(
            self.request("POST", "/user/logout", self.token).status_code, 200
        )
        self.assertEqual(self.request("GET", "/user/me", self.token).status_code, 401)
        self.assertEqual(
            self.request("GET", url.removeprefix("/api/v1")).status_code, 401
        )

    def test_password_change_invalidates_existing_sessions(self):
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE users SET password_hash='changed' WHERE id=?", (self.alice.id,)
            )
        self.assertEqual(self.request("GET", "/user/me", self.token).status_code, 401)

    def test_download_scope_expiry_and_static_bypass(self):
        url = security.download_url(
            "document", self.principal, "document"
        ).removeprefix("/api/v1")
        self.assertEqual(self.request("GET", url).content, b"fixture")
        self.assertEqual(
            self.request(
                "GET", url.replace("/document/document", "/media/image")
            ).status_code,
            401,
        )
        with database.get_db_connection() as conn:
            conn.execute("UPDATE download_tickets SET expires_at=0")
        self.assertEqual(self.request("GET", url).status_code, 401)
        self.assertEqual(
            self.request("GET", "/media/uploads/fixture.png").status_code, 404
        )

    def test_guests_are_isolated_and_cannot_use_user_or_admin_features(self):
        first = self.request("POST", "/user/guest").json()
        second = self.request("POST", "/user/guest").json()
        payload = {"session_id": "guest-fixture", "message": "guest message"}
        self.assertEqual(
            self.request(
                "POST", "/chat/stream", first["access_token"], json=payload
            ).status_code,
            200,
        )
        self.assertEqual(
            self.request(
                "POST", "/chat/stream", second["access_token"], json=payload
            ).status_code,
            404,
        )
        self.assertEqual(
            self.request("GET", "/user/me", first["access_token"]).status_code, 403
        )
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT COUNT(*) FROM messages WHERE session_id='guest-fixture'"
                ).fetchone()[0],
                1,
            )
        for path in ("/document/clear-all", "/session/purge-temporary"):
            self.assertEqual(self.request("POST", path, self.token).status_code, 403)
            settings.ADMIN_USER_IDS = [self.alice.id]
            try:
                self.assertEqual(
                    self.request("POST", path, self.token).status_code, 200
                )
            finally:
                settings.ADMIN_USER_IDS = []

    def test_duplicate_session_creation_preserves_children_and_owner(self):
        from app.services.chat_history_service import chat_history_service

        chat_history_service.save_message("alice-session", "user", "Keep me")
        response = self.request(
            "POST",
            "/session/create",
            self.token,
            json={"user_id": self.alice.id, "session_id": "alice-session"},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["message_count"], 1)

    def test_attachment_id_is_authorized_and_url_cannot_choose_a_fetch_target(self):
        payload = {
            "session_id": "bob-session",
            "message": "hello",
            "attachments": [
                {"id": "image", "url": "http://private.invalid", "file_type": "image"}
            ],
        }
        self.assertEqual(
            self.request(
                "POST", "/chat/stream", self.other_token, json=payload
            ).status_code,
            404,
        )
        payload["session_id"] = "alice-session"
        self.assertEqual(
            self.request("POST", "/chat/stream", self.token, json=payload).status_code,
            200,
        )

    def test_registration_and_password_login_issue_credentials(self):
        registered = self.request(
            "POST",
            "/user/register",
            json={
                "username": "newperson",
                "email": "newperson@example.invalid",
                "display_name": "Third Person",
                "password": "Durable!482Strong",
            },
        )
        self.assertEqual(registered.status_code, 201)
        self.assertEqual(
            self.request("GET", "/user/me", registered.json()["access_token"]).json()[
                "id"
            ],
            registered.json()["id"],
        )
        response = self.request(
            "POST",
            "/user/login",
            json={"username_or_email": "alice", "password": "Durable!482Strong"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.request("GET", "/user/me", response.json()["access_token"]).json()[
                "id"
            ],
            self.alice.id,
        )
        self.assertNotIn(
            "access_token", self.request("GET", "/user/me", self.token).json()
        )

    def test_upgrade_preserves_existing_users_sessions_and_assets(self):
        # Recreate the prior schema using only this test's disposable database.
        with database.get_db_connection() as conn:
            conn.execute("DROP TABLE download_tickets")
            conn.execute("DROP TABLE auth_sessions")
            conn.execute("DROP INDEX idx_users_google_subject")
            conn.execute("ALTER TABLE users DROP COLUMN google_subject")
        database.init_db()
        database.init_db()
        response = self.request(
            "POST",
            "/user/login",
            json={
                "username_or_email": "alice",
                "password": "Durable!482Strong",
            },
        )
        self.assertEqual(response.status_code, 200)
        token = response.json()["access_token"]
        self.assertEqual(response.json()["id"], self.alice.id)
        self.assertEqual(
            self.request("GET", "/session/alice-session/history", token).status_code,
            200,
        )
        self.assertEqual(self.request("GET", "/media/assets", token).json()["total"], 2)
        self.assertEqual(
            self.request("GET", "/media/content/media/image", token).content,
            b"fixture-image",
        )

    def test_otp_login_and_password_reset_credentials(self):
        def otp(identifier, purpose):
            with database.get_db_connection() as conn:
                conn.execute(
                    "INSERT INTO email_otps(id,email,otp_code,expires_at,created_at,purpose,delivery_status) VALUES(?,?,?,?,?,?,?)",
                    (
                        identifier,
                        self.alice.email,
                        hash_password("123456", identifier),
                        time.time() + 300,
                        "2026-01-01",
                        purpose,
                        "sent",
                    ),
                )

        otp("login-code", "login")
        response = self.request(
            "POST",
            "/user/otp/verify",
            json={
                "email_or_username": "alice",
                "otp": "123456",
            },
        )
        self.assertEqual(response.status_code, 200)
        otp_token = response.json()["access_token"]
        self.assertEqual(self.request("GET", "/user/me", otp_token).status_code, 200)
        self.assertEqual(
            self.request(
                "POST",
                "/user/otp/verify",
                json={
                    "email_or_username": "alice",
                    "otp": "123456",
                },
            ).status_code,
            400,
        )
        otp("reset-code", "reset")
        response = self.request(
            "POST",
            "/user/password-reset/verify",
            json={
                "email_or_username": "alice",
                "otp": "123456",
                "new_password": "Another!482Strong",
            },
        )
        self.assertEqual(response.status_code, 200)
        for token in (self.token, otp_token):
            self.assertEqual(self.request("GET", "/user/me", token).status_code, 401)
        self.assertEqual(
            self.request(
                "POST",
                "/user/login",
                json={
                    "username_or_email": "alice",
                    "password": "Another!482Strong",
                },
            ).status_code,
            200,
        )

    def test_owned_image_avatar_uploads_and_protected_downloads(self):
        image = self.image_fixture()
        response = self.request(
            "POST",
            "/media/upload",
            self.token,
            data={"session_id": "alice-session"},
            files={"file": ("../../fixture.png", image, "image/png")},
        )
        self.assertEqual(response.status_code, 201)
        attachment = response.json()
        url = attachment["url"].removeprefix("/api/v1")
        self.assertEqual(self.request("GET", url).content, image)
        self.assertEqual(
            self.request(
                "GET", "/media/content/media/" + attachment["id"], self.other_token
            ).status_code,
            404,
        )
        avatar = self.request(
            "POST",
            "/user/avatar",
            self.token,
            data={"user_id": self.alice.id},
            files={"file": ("fixture.png", image, "image/png")},
        )
        self.assertEqual(avatar.status_code, 200)
        avatar_url = avatar.json()["avatar_url"].removeprefix("/api/v1")
        self.assertEqual(self.request("GET", avatar_url).content, image)
        self.assertEqual(
            self.request(
                "GET", "/media/content/avatar/" + self.alice.id, self.other_token
            ).status_code,
            403,
        )
        self.assertEqual(
            self.request(
                "DELETE", "/user/avatar?user_id=" + self.alice.id, self.token
            ).status_code,
            200,
        )
        self.assertEqual(self.request("GET", avatar_url).status_code, 404)

    def test_raster_uploads_use_verified_mime_types_and_safe_download_headers(self):
        for image_format, extension, mime in (
            ("PNG", "png", "image/png"),
            ("JPEG", "jpg", "image/jpeg"),
            ("WEBP", "webp", "image/webp"),
            ("GIF", "gif", "image/gif"),
            ("BMP", "bmp", "image/bmp"),
        ):
            with self.subTest(format=image_format):
                image = self.image_fixture(image_format)
                response = self.request(
                    "POST",
                    "/media/upload",
                    self.token,
                    data={"session_id": "alice-session"},
                    files={"file": (f"fixture.{extension}", image, "text/html")},
                )
                self.assertEqual(response.status_code, 201)
                asset = response.json()
                self.assertEqual(asset["mime_type"], mime)
                downloaded = self.request("GET", asset["url"].removeprefix("/api/v1"))
                self.assertEqual(downloaded.content, image)
                self.assertEqual(downloaded.headers["content-type"], mime)
                self.assertEqual(
                    downloaded.headers["x-content-type-options"], "nosniff"
                )
                self.assertEqual(
                    downloaded.headers["content-security-policy"], "sandbox"
                )
                self.assertNotIn("content-disposition", downloaded.headers)

    def test_invalid_images_are_rejected_before_storage_and_registration(self):
        from app.services.storage_service import storage_service

        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>window.fixture=true</script></svg>'
        invalid = [
            ("fixture.svg", svg),
            ("renamed.png", svg),
            ("html.jpg", b"<html>fixture</html>"),
            ("corrupt.png", self.image_fixture()[:25]),
            ("mismatch.jpg", self.image_fixture()),
            ("empty.png", b""),
        ]
        with database.get_db_connection() as conn:
            before = conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0]
        with patch.object(storage_service, "upload_file") as upload:
            for filename, data in invalid:
                with self.subTest(filename=filename):
                    response = self.request(
                        "POST",
                        "/media/upload",
                        self.token,
                        data={"session_id": "alice-session"},
                        files={"file": (filename, data, "image/png")},
                    )
                    self.assertEqual(response.status_code, 400)
                    self.assertIsInstance(response.json()["detail"], str)
            upload.assert_not_called()
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0], before
            )

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
        with (
            patch.object(image_validation, "MAX_IMAGE_PIXELS", 1),
            self.assertRaises(security.HTTPException) as raised,
        ):
            image_validation.validate_image(image, "fixture.png")
        self.assertEqual(raised.exception.status_code, 413)
        with self.assertRaises(security.HTTPException) as raised:
            image_validation.validate_image(image, "fixture.png", max_bytes=3)
        self.assertEqual(raised.exception.status_code, 413)
        animated = self.image_fixture("GIF", animated=True)
        for field, limit in (("MAX_IMAGE_FRAMES", 1), ("MAX_TOTAL_IMAGE_PIXELS", 65)):
            with (
                patch.object(image_validation, field, limit),
                self.assertRaises(security.HTTPException) as raised,
            ):
                image_validation.validate_image(animated, "fixture.gif")
            self.assertEqual(raised.exception.status_code, 413)
        slots = threading.BoundedSemaphore(1)
        slots.acquire()
        with (
            patch.object(image_validation, "_validation_slots", slots),
            self.assertRaises(security.HTTPException) as raised,
        ):
            image_validation.validate_image(image, "fixture.png")
        self.assertEqual(raised.exception.status_code, 503)
        slots.release()
        self.assertEqual(
            image_validation.validate_image(image, "fixture.png")[1], "image/png"
        )

    def test_valid_animated_images_keep_their_frames(self):
        from PIL import Image

        image = self.image_fixture("GIF", animated=True)
        response = self.request(
            "POST",
            "/media/upload",
            self.token,
            data={"session_id": "alice-session"},
            files={"file": ("animated.gif", image, "image/gif")},
        )
        self.assertEqual(response.status_code, 201)
        downloaded = self.request("GET", response.json()["url"].removeprefix("/api/v1"))
        with Image.open(io.BytesIO(downloaded.content)) as decoded:
            self.assertEqual(getattr(decoded, "n_frames", 1), 2)

    def test_invalid_avatar_preserves_previous_image_and_legacy_routes_are_safe(self):
        from app.services.storage_service import storage_service

        image = self.image_fixture()
        response = self.request(
            "POST",
            "/user/avatar",
            self.token,
            data={"user_id": self.alice.id},
            files={"file": ("fixture.png", image, "image/png")},
        )
        self.assertEqual(response.status_code, 200)
        with patch.object(storage_service, "upload_file") as upload:
            invalid = self.request(
                "POST",
                "/user/avatar",
                self.token,
                data={"user_id": self.alice.id},
                files={"file": ("fake.png", b"<svg>fixture</svg>", "image/png")},
            )
            self.assertEqual(invalid.status_code, 400)
            upload.assert_not_called()
        self.assertEqual(
            self.request("GET", "/user/avatar/" + self.alice.id, self.token).content,
            image,
        )
        # Simulate an old SVG/HTML upload mislabeled as PNG, without executing it.
        (root / "avatars" / f"{self.alice.id}.png").write_bytes(
            b"<svg>legacy fixture</svg>"
        )
        for url in (
            "/user/avatar/" + self.alice.id,
            "/media/content/avatar/" + self.alice.id,
        ):
            downloaded = self.request("GET", url, self.token)
            self.assertEqual(
                downloaded.headers["content-type"], "application/octet-stream"
            )
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
            conn.execute(
                "UPDATE media_assets SET file_path='media/uploads/cloud-active.png' WHERE id='image'"
            )
        client = Mock()
        client.get_object.return_value = {"Body": io.BytesIO(active)}
        with (
            patch.object(storage_service, "_s3_client", client),
            patch.object(storage_service, "_initialized", True),
        ):
            response = self.request("GET", "/media/content/media/image", self.token)
        self.assertEqual(response.headers["content-disposition"], "attachment")
        self.assertEqual(response.headers["content-type"], "application/octet-stream")

    def test_cloud_and_generated_images_use_detected_content_type(self):
        from app.services.media_service import media_service
        from app.services.storage_service import storage_service

        image = self.image_fixture()
        client = Mock()
        with (
            patch.object(storage_service, "_s3_client", client),
            patch.object(storage_service, "_initialized", True),
        ):
            response = self.request(
                "POST",
                "/media/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("fixture.png", image, "text/html")},
            )
            self.assertEqual(response.status_code, 201)
            self.assertEqual(
                client.put_object.call_args.kwargs["ContentType"], "image/png"
            )
            generated = media_service.save_generated_image(
                image, "fixture", "alice-session", self.alice.id, ext=".jpg"
            )
            self.assertEqual(generated.mime_type, "image/png")
            self.assertTrue((generated.file_name or "").endswith(".png"))
            self.assertEqual(
                client.put_object.call_args.kwargs["ContentType"], "image/png"
            )
            client.put_object.reset_mock()
            with self.assertRaises(security.HTTPException):
                media_service.save_generated_image(
                    b"<svg>invalid fixture</svg>",
                    "fixture",
                    "alice-session",
                    self.alice.id,
                )
            client.put_object.assert_not_called()

    def test_cloud_documents_cannot_spoof_active_image_content_types(self):
        from app.services.storage_service import storage_service

        client = Mock()
        with (
            patch.object(storage_service, "_s3_client", client),
            patch.object(storage_service, "_initialized", True),
        ):
            storage_service.upload_file(
                b"<svg>fixture</svg>",
                "documents/alice-session/fixture.txt",
                "image/svg+xml",
            )
        self.assertEqual(
            client.put_object.call_args.kwargs["ContentType"],
            "application/octet-stream",
        )
        self.assertEqual(
            client.put_object.call_args.kwargs["ContentDisposition"], "attachment"
        )

    def test_document_upload_sanitizes_paths_and_removes_temporary_files(self):
        from app.repositories.session_store import session_store_repo
        from app.schemas.document import DocumentMetadata
        from app.services.rag_service import rag_service

        temporary_paths = []

        def index(
            file_path, filename, session_id, user_id, storage_url, extracted_pages=None
        ):
            temporary_paths.append(file_path)
            self.assertTrue(
                file_path.resolve().is_relative_to(settings.UPLOAD_DIR.resolve())
            )
            metadata = DocumentMetadata(
                document_id=f"uploaded-document-{len(temporary_paths)}",
                filename=filename,
                file_type="txt",
                file_size_bytes=len(file_path.read_bytes()),
                total_chunks=1,
                storage_url=storage_url,
                uploaded_at="2026-01-01",
            )
            session_store_repo.save_document_metadata(metadata, user_id, session_id)
            session_store_repo.attach_document_to_session(
                session_id, metadata.document_id
            )
            return metadata

        import re

        from app.services.storage_service import storage_service

        with patch.object(rag_service, "process_and_index_document", side_effect=index):
            for original, expected in (
                ("../../fixture.txt", "fixture.txt"),
                (r"..\..\windows.txt", "windows.txt"),
                ("CON.txt", "CON.txt"),
                ("fixture:stream.txt", "fixture:stream.txt"),
            ):
                with self.subTest(filename=original):
                    response = self.request(
                        "POST",
                        "/document/upload",
                        self.token,
                        data={"session_id": "alice-session"},
                        files={"file": (original, b"uploaded document", "text/plain")},
                    )
                    self.assertEqual(response.status_code, 201)
                    document = response.json()["document"]
                    self.assertEqual(document["filename"], expected)
                    with database.get_db_connection() as conn:
                        stored = conn.execute(
                            "SELECT storage_url FROM documents WHERE id=?",
                            (document["document_id"],),
                        ).fetchone()[0]
                    key = storage_service.owned_storage_key(
                        {"storage_url": stored}, "document"
                    )
                    self.assertIsNotNone(
                        re.fullmatch(r"documents/alice-session/[0-9a-f]{32}\.txt", key)
                    )
                    self.assertEqual(
                        self.request(
                            "GET", document["storage_url"].removeprefix("/api/v1")
                        ).content,
                        b"uploaded document",
                    )
        self.assertTrue(temporary_paths)
        self.assertTrue(all(not path.exists() for path in temporary_paths))

    def test_upload_rejects_path_shaped_session_ids_before_file_writes(self):
        from app.services.rag_service import rag_service
        from app.services.storage_service import storage_service

        with (
            patch.object(rag_service, "process_and_index_document") as index,
            patch.object(storage_service, "upload_file") as upload,
        ):
            for session in (
                "../outside",
                r"..\outside",
                "/absolute",
                "C:/absolute",
                "nested/session",
                "%2e%2e",
                "x" * 129,
            ):
                for path in ("/document/upload", "/media/upload"):
                    with self.subTest(session=session, path=path):
                        response = self.request(
                            "POST",
                            path,
                            self.token,
                            data={"session_id": session},
                            files={
                                "file": (
                                    "fixture.txt"
                                    if path.startswith("/document")
                                    else "fixture.png",
                                    b"fixture",
                                    "application/octet-stream",
                                )
                            },
                        )
                        self.assertEqual(response.status_code, 400)
            index.assert_not_called()
            upload.assert_not_called()

    def test_storage_rejects_unsafe_keys_before_disk_or_r2_writes(self):
        from app.services.storage_service import storage_service

        data = root / (self.__class__.__name__ + "-storage-keys")
        data.mkdir()
        client = Mock()
        keys = (
            "",
            "/absolute.txt",
            "../outside.txt",
            "media/../../outside.txt",
            r"..\outside.txt",
            "C:/outside.txt",
            r"\\host\share\outside.txt",
            "media/file.txt:stream.txt",
            "media/CON.txt",
            "media/NUL.txt",
            "media/file.txt.",
            "media/file.txt ",
            "media//file.txt",
            "media/./file.txt",
            "media/invalid\x00.txt",
        )
        with (
            patch.object(settings, "DATA_DIR", data),
            patch.object(storage_service, "_s3_client", client),
        ):
            for cloud in (False, True):
                with patch.object(storage_service, "_initialized", cloud):
                    for key in keys:
                        with (
                            self.subTest(cloud=cloud, key=key),
                            self.assertRaises(ValueError),
                        ):
                            storage_service.upload_file(b"fixture", key)
            client.put_object.assert_not_called()
        self.assertEqual(list(data.iterdir()), [])

    def test_storage_valid_keys_work_in_local_r2_and_cloud_fallback_modes(self):
        from app.services.storage_service import storage_service

        data = root / (self.__class__.__name__ + "-storage-valid")
        data.mkdir()
        client = Mock()
        with (
            patch.object(settings, "DATA_DIR", data),
            patch.object(
                settings, "CLOUDFLARE_R2_PUBLIC_URL", "https://cdn.fixture.invalid"
            ),
            patch.object(settings, "r2_endpoint_url", "https://r2.fixture.invalid"),
            patch.object(storage_service, "_s3_client", client),
        ):
            with patch.object(storage_service, "_initialized", False):
                url, key = storage_service.upload_file(
                    b"local", "documents/session/object.txt"
                )
                self.assertEqual(url, "/api/v1/media/documents/session/object.txt")
                self.assertEqual((data / key).read_bytes(), b"local")
            with patch.object(storage_service, "_initialized", True):
                url, key = storage_service.upload_file(
                    b"cloud", "media/uploads/object.png"
                )
                self.assertEqual(url, "/api/v1/media/uploads/object.png")
                self.assertEqual(key, "media/uploads/object.png")
                self.assertEqual(client.put_object.call_args.kwargs["Key"], key)
                self.assertFalse((data / key).exists())
                client.put_object.side_effect = RuntimeError("fixture provider failure")
                url, key = storage_service.upload_file(
                    b"fallback", "media/generated/object.png"
                )
                self.assertEqual(url, "/api/v1/media/generated/object.png")
                self.assertEqual((data / key).read_bytes(), b"fallback")

    def test_storage_fallback_uploads_keep_authenticated_downloads_working(self):
        from app.services.storage_service import storage_service

        image_bytes = self.image_fixture()
        objects = {}
        client = Mock()
        client.put_object.side_effect = lambda **kwargs: objects.update(
            {kwargs["Key"]: kwargs["Body"]}
        )
        client.get_object.side_effect = lambda **kwargs: {
            "Body": io.BytesIO(objects[kwargs["Key"]])
        }
        with (
            patch.object(storage_service, "_s3_client", client),
            patch.object(settings, "r2_endpoint_url", "https://r2.fixture.invalid"),
        ):
            for cdn in ("", "https://cdn.fixture.invalid"):
                for backend in ("local", "r2", "fallback"):
                    with (
                        self.subTest(cdn=cdn, backend=backend),
                        patch.object(settings, "CLOUDFLARE_R2_PUBLIC_URL", cdn),
                        patch.object(
                            storage_service, "_initialized", backend != "local"
                        ),
                        patch.object(
                            client,
                            "put_object",
                            side_effect=(
                                RuntimeError("fixture R2 failure")
                                if backend == "fallback"
                                else lambda **kwargs: objects.update(
                                    {kwargs["Key"]: kwargs["Body"]}
                                )
                            ),
                        ),
                    ):
                        response = self.request(
                            "POST",
                            "/media/upload",
                            self.token,
                            data={"session_id": "alice-session"},
                            files={"file": ("fixture.png", image_bytes, "image/png")},
                        )
                        self.assertEqual(response.status_code, 201, response.text)
                        attachment = response.json()
                        self.assertTrue(
                            attachment["url"].startswith("/api/v1/media/content/media/")
                        )
                        self.assertEqual(
                            self.request(
                                "GET", attachment["url"].removeprefix("/api/v1")
                            ).content,
                            image_bytes,
                        )
                        self.assertEqual(
                            self.request(
                                "GET",
                                f"/media/content/media/{attachment['id']}",
                                self.other_token,
                            ).status_code,
                            404,
                        )
                        with database.get_db_connection() as conn:
                            row = conn.execute(
                                "SELECT file_path,file_url FROM media_assets WHERE id=?",
                                (attachment["id"],),
                            ).fetchone()
                        self.assertTrue(
                            row["file_url"].startswith("/api/v1/media/uploads/")
                        )
                        self.assertEqual(
                            (root / row["file_path"]).exists(), backend != "r2"
                        )

    def reference_generator(self, handler=None):
        """Load the production constructor with only an offline HTTP transport."""
        original = httpx.AsyncClient

        def client(**kwargs):
            self.assertFalse(kwargs["follow_redirects"])
            self.assertFalse(kwargs["trust_env"])
            self.assertEqual(
                kwargs["timeout"].read, settings.IMAGE_GENERATION_TIMEOUT_SECONDS
            )
            kwargs["transport"] = httpx.MockTransport(
                handler
                or (
                    lambda request: httpx.Response(
                        200, json=self.image_provider_payload()
                    )
                )
            )
            return original(**kwargs)

        with (
            patch.object(settings, "CLOUDFLARE_AI_ACCOUNT_ID", "a" * 32),
            patch.object(
                settings, "CLOUDFLARE_AI_API_TOKEN", "fixture-workers-ai-token"
            ),
            patch.object(httpx, "AsyncClient", side_effect=client),
        ):
            return runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1]
                    / "app/services/image_gen_service.py"
                )
            )["image_gen_service"]

    async def image_provider_request(self, handler, operation=None):
        actual = self.reference_generator(handler)
        # Backoff is tested through request counts, without delaying the suite.
        original_sleep = asyncio.sleep

        async def fast_sleep(delay):
            await original_sleep(0)

        try:
            with patch.object(asyncio, "sleep", side_effect=fast_sleep):
                if operation:
                    return await operation(actual)
                return await actual.generate_image("  A tree  ", "alice-session")
        finally:
            await actual.aclose()

    def image_provider_payload(self):
        return {
            "success": True,
            "result": {"image": base64.b64encode(self.image_fixture()).decode()},
            "errors": [],
            "messages": [],
        }

    def image_multipart(self, request):
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.url.host, "api.cloudflare.com")
        self.assertEqual(
            request.url.path,
            "/client/v4/accounts/"
            + "a" * 32
            + "/ai/run/@cf/black-forest-labs/flux-2-klein-4b",
        )
        self.assertEqual(
            request.headers["authorization"], "Bearer fixture-workers-ai-token"
        )
        content_type = request.headers["content-type"]
        self.assertTrue(content_type.startswith("multipart/form-data; boundary="))
        message = BytesParser(policy=email_policy).parsebytes(
            b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + request.content
        )
        return {
            part.get_param("name", header="content-disposition"): (
                part.get_content_type(),
                part.get_payload(decode=True),
            )
            for part in message.iter_parts()
        }

    def test_reference_analysis_uses_actual_images_in_all_storage_modes(self):
        from PIL import Image

        from app.services.media_service import media_service
        from app.services.storage_service import storage_service

        for backend, image_format in (
            ("local", "PNG"),
            ("r2", "JPEG"),
            ("fallback", "WEBP"),
            ("local", "GIF"),
            ("local", "BMP"),
        ):
            calls = []

            def handler(request):
                calls.append(self.image_multipart(request))
                return httpx.Response(200, json=self.image_provider_payload())

            client = Mock()
            image_bytes = self.image_fixture(image_format)
            client.get_object.return_value = {"Body": io.BytesIO(image_bytes)}
            client.put_object.side_effect = (
                RuntimeError("fixture R2 failure") if backend == "fallback" else None
            )
            with (
                self.subTest(backend=backend),
                patch.object(storage_service, "_s3_client", client),
                patch.object(storage_service, "_initialized", backend != "local"),
            ):
                _, key = storage_service.upload_file(
                    image_bytes, f"media/uploads/{backend}-reference.img"
                )

                async def edit(actual):
                    return await actual.generate_from_reference(
                        "Change the background", key, "alice-session", self.alice.id
                    )

                generated = asyncio.run(self.image_provider_request(handler, edit))
                client.get_object.return_value = {"Body": io.BytesIO(image_bytes)}
                self.assertEqual(media_service.get_media_bytes(key), image_bytes)
            self.assertEqual(calls[0]["prompt"][1], b"Change the background")
            self.assertEqual(calls[0]["input_image_0"][0], "image/png")
            with Image.open(io.BytesIO(calls[0]["input_image_0"][1])) as sent:
                with Image.open(io.BytesIO(image_bytes)) as original:
                    self.assertEqual(sent.size, original.size)
                    self.assertEqual(
                        sent.convert("RGB").tobytes(), original.convert("RGB").tobytes()
                    )
            self.assertEqual(generated.prompt, "Change the background")

    def test_reference_images_are_oriented_resized_and_stripped_without_changing_upload(
        self,
    ):
        from PIL import Image

        from app.services.media_service import media_service

        output = io.BytesIO()
        image = Image.new("RGB", (1200, 600), "red")
        exif = Image.Exif()
        exif[274] = 6
        exif[315] = "fixture private metadata"
        image.save(output, format="JPEG", exif=exif)
        reference = output.getvalue()
        calls = []

        def handler(request):
            calls.append(self.image_multipart(request))
            return httpx.Response(200, json=self.image_provider_payload())

        async def edit(actual):
            return await actual.generate_from_reference(
                "Rotate the scene", "media/uploads/reference.jpg", "alice-session"
            )

        with patch.object(media_service, "get_media_bytes", return_value=reference):
            asyncio.run(self.image_provider_request(handler, edit))
        with Image.open(io.BytesIO(calls[0]["input_image_0"][1])) as sent:
            self.assertEqual(sent.size, (256, 511))
            self.assertEqual(sent.format, "PNG")
            self.assertFalse(sent.getexif())
            self.assertNotIn("exif", sent.info)
        self.assertEqual(output.getvalue(), reference)

    def test_reference_analysis_failures_never_fall_back_to_unconditioned_generation(
        self,
    ):
        from app.services.media_service import media_service

        for failure in ("missing", "invalid", "unconfigured", "provider", "empty"):
            calls = []

            def handler(request):
                calls.append(self.image_multipart(request))
                if failure == "provider":
                    raise RuntimeError("private provider detail")
                payload = self.image_provider_payload()
                if failure == "empty":
                    payload["result"] = {}
                return httpx.Response(200, json=payload)

            async def edit(actual):
                if failure == "unconfigured":
                    await actual.aclose()
                return await actual.generate_from_reference(
                    "Use this image", "media/uploads/reference.png"
                )

            reference = (
                None
                if failure == "missing"
                else b"invalid"
                if failure == "invalid"
                else self.image_fixture()
            )
            with (
                self.subTest(failure=failure),
                patch.object(media_service, "get_media_bytes", return_value=reference),
                patch.object(media_service, "save_generated_image") as save,
                self.assertRaises(RuntimeError) as error,
            ):
                asyncio.run(self.image_provider_request(handler, edit))
            self.assertNotIn("private provider detail", str(error.exception))
            self.assertEqual(
                len(calls),
                0 if failure in ("missing", "invalid", "unconfigured") else 1,
            )
            if calls:
                self.assertIn("input_image_0", calls[0])
            save.assert_not_called()

    def test_reference_analysis_failure_reaches_clients_as_an_error_event(self):
        from app.api.v1.endpoints import chat

        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(
                429,
                json={
                    "success": False,
                    "errors": [{"code": 3036, "message": "private provider detail"}],
                },
            )

        actual = self.reference_generator(handler)
        (settings.UPLOAD_IMAGE_DIR / "fixture.png").write_bytes(self.image_fixture())
        providers = {}
        for name in ("llm_service", "image_gen_service", "web_search_service"):
            stub = types.ModuleType("app.services." + name)
            setattr(stub, name, actual if name == "image_gen_service" else Mock())
            providers[stub.__name__] = stub
        with patch.dict(sys.modules, providers):
            orchestrator = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"
                )
            )["chat_orchestrator"]
        try:
            with (
                patch.object(chat, "chat_orchestrator", orchestrator),
                patch.object(
                    settings, "DEFAULT_LLM_MODEL", "fixture-model", create=True
                ),
            ):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "alice-session",
                        "mode": "IMAGE_GENERATION",
                        "message": "Draw a variation",
                        "attachments": [{"id": "image", "file_type": "image"}],
                    },
                )
        finally:
            asyncio.run(actual.aclose())
        self.assertEqual(response.status_code, 200)
        self.assertIn('"event": "error"', response.text)
        self.assertIn("free image allowance", response.text)
        self.assertNotIn('"event": "done"', response.text)
        self.assertNotIn('"event": "media"', response.text)
        self.assertNotIn("private provider detail", response.text)
        self.assertEqual(len(calls), 1)

    def test_workers_ai_generates_and_edits_with_owned_downloads(self):
        calls = []

        def handler(request):
            calls.append(self.image_multipart(request))
            return httpx.Response(200, json=self.image_provider_payload())

        generated = asyncio.run(self.image_provider_request(handler))
        self.assertEqual(generated.prompt, "A tree")
        self.assertEqual(set(calls[0]), {"prompt", "width", "height"})
        self.assertEqual(calls[0]["prompt"][1], b"A tree")
        self.assertEqual(calls[0]["width"][1], b"1024")
        self.assertEqual(calls[0]["height"][1], b"1024")
        reference = self.image_fixture("JPEG")
        (settings.UPLOAD_IMAGE_DIR / "fixture.png").write_bytes(reference)

        async def edit(actual):
            return await actual.generate_from_reference(
                "Make the sky blue", "media/uploads/fixture.png", "alice-session"
            )

        edited = asyncio.run(self.image_provider_request(handler, edit))
        self.assertEqual(calls[1]["prompt"][1], b"Make the sky blue")
        self.assertIn("input_image_0", calls[1])
        library = self.request("GET", "/media/assets", self.token).json()["items"]
        for asset in (generated, edited):
            item = next(item for item in library if item["id"] == asset.id)
            self.assertEqual(item["user_id"], self.alice.id)
            self.assertEqual(
                self.request("GET", item["url"].removeprefix("/api/v1")).content,
                self.image_fixture(),
            )

    def test_workers_ai_retries_only_transient_failures_with_one_budget(self):
        for status, code, attempts, message in (
            (400, 5006, 1, "could not be processed"),
            (400, 5007, 1, "model is unavailable"),
            (401, 10000, 1, "provider access"),
            (402, 0, 1, "current provider plan"),
            (403, 5018, 1, "provider access"),
            (403, 5035, 1, "current provider plan"),
            (404, 3042, 1, "model is unavailable"),
            (413, 3006, 1, "too large"),
            (429, 3036, 1, "free image allowance"),
            (500, 3036, 1, "free image allowance"),
            (429, 0, 1, "rate limited"),
            (429, 3040, 3, "rate limited"),
            (400, 3030, 1, "blocked by the provider"),
            (500, 3030, 1, "blocked by the provider"),
            (200, 3030, 1, "blocked by the provider"),
            (408, 3007, 3, "temporarily unavailable"),
            (500, 0, 3, "temporarily unavailable"),
            (502, 0, 3, "temporarily unavailable"),
            (503, 0, 3, "temporarily unavailable"),
            (504, 0, 3, "temporarily unavailable"),
            (302, 0, 1, "temporarily unavailable"),
        ):
            calls = []

            def handler(request):
                calls.append(request)
                return httpx.Response(
                    status,
                    json={
                        "success": False,
                        "errors": [
                            {"code": code, "message": "private provider details"}
                        ],
                    },
                    headers={"location": "https://untrusted.invalid/"},
                )

            with (
                self.subTest(status=status, code=code),
                self.assertRaises(RuntimeError) as error,
            ):
                asyncio.run(self.image_provider_request(handler))
            self.assertIn(message, str(error.exception))
            self.assertNotIn("private provider details", str(error.exception))
            self.assertEqual(len(calls), attempts)

        for transient in (503, "connect", "connect_timeout"):
            calls = []

            def recovery(request):
                calls.append(request)
                if len(calls) == 1:
                    if transient == "connect":
                        raise httpx.ConnectError(
                            "fixture network error", request=request
                        )
                    if transient == "connect_timeout":
                        raise httpx.ConnectTimeout("fixture timeout", request=request)
                    return httpx.Response(503, json={"success": False})
                return httpx.Response(200, json=self.image_provider_payload())

            asyncio.run(self.image_provider_request(recovery))
            self.assertEqual(len(calls), 2)

        calls = []

        def read_timeout(request):
            calls.append(request)
            raise httpx.ReadTimeout("private timeout detail", request=request)

        with self.assertRaisesRegex(RuntimeError, "timed out"):
            asyncio.run(self.image_provider_request(read_timeout))
        self.assertEqual(
            len(calls), 1
        )  # Do not repeat an ambiguously completed generation.

    def test_workers_ai_rejects_invalid_output_without_saving(self):
        from app.services.media_service import media_service

        for failure in (
            "empty",
            "text",
            "list",
            "result_type",
            "image_type",
            "base64",
            "corrupt",
            "svg",
            "url",
            "invalid_json",
            "false_success",
            "errors_with_image",
            "oversize_image",
        ):
            calls = []

            def handler(request):
                calls.append(request)
                payload = self.image_provider_payload()
                if failure == "empty":
                    payload["result"] = {}
                elif failure == "text":
                    payload["result"] = {"text": "No image"}
                elif failure == "list":
                    payload = []
                elif failure == "result_type":
                    payload["result"] = "image"
                elif failure == "image_type":
                    payload["result"]["image"] = [1, 2]
                elif failure == "base64":
                    payload["result"]["image"] = "!!!invalid"
                elif failure in ("corrupt", "svg"):
                    payload["result"]["image"] = base64.b64encode(
                        b"not an image" if failure == "corrupt" else b"<svg></svg>"
                    ).decode()
                elif failure == "url":
                    payload["result"]["image"] = "https://untrusted.invalid/image.png"
                elif failure == "invalid_json":
                    return httpx.Response(200, content=b"{broken")
                elif failure == "false_success":
                    payload["success"] = False
                elif failure == "errors_with_image":
                    payload["errors"] = [{"code": 3030}]
                elif failure == "oversize_image":
                    payload["result"]["image"] = "A" * 160
                return httpx.Response(200, json=payload)

            async def generate(actual):
                if failure == "oversize_image":
                    with patch.dict(
                        actual._image_bytes.__globals__, {"MAX_FILE_SIZE_BYTES": 16}
                    ):
                        return await actual.generate_image("A tree", "alice-session")
                return await actual.generate_image("A tree", "alice-session")

            with (
                self.subTest(failure=failure),
                patch.object(media_service, "save_generated_image") as save,
                self.assertRaises(RuntimeError),
            ):
                asyncio.run(self.image_provider_request(handler, generate))
            save.assert_not_called()
            self.assertEqual(len(calls), 1)

    def test_workers_ai_bounds_response_body_even_without_content_length(self):
        from app.services.media_service import media_service

        for declare_length in (False, True):
            closed = []

            class LargeBody(httpx.AsyncByteStream):
                async def __aiter__(self):
                    yield b"x" * 60
                    yield b"x" * 60
                    raise AssertionError("Oversized body must stop reading")

                async def aclose(self):
                    closed.append(True)

            def handler(request):
                return httpx.Response(
                    200,
                    stream=LargeBody(),
                    headers={"Content-Length": "120"} if declare_length else {},
                )

            async def generate(actual):
                with patch.dict(
                    actual._read_payload.__globals__, {"MAX_RESPONSE_BYTES": 100}
                ):
                    return await actual.generate_image("A tree", "alice-session")

            with patch.object(media_service, "save_generated_image") as save:
                with self.assertRaisesRegex(RuntimeError, "too large"):
                    asyncio.run(self.image_provider_request(handler, generate))
                save.assert_not_called()
            self.assertEqual(closed, [True])

    def test_workers_ai_configuration_validation_and_storage_failure(self):
        from app.services.media_service import media_service

        for failure in ("blank", "unconfigured", "aspect_ratio"):
            calls = []

            def handler(request):
                calls.append(request)
                return httpx.Response(200, json=self.image_provider_payload())

            async def generate(actual):
                if failure == "unconfigured":
                    await actual.aclose()
                return await actual.generate_image(
                    " " if failure == "blank" else "A tree",
                    aspect_ratio="bad" if failure == "aspect_ratio" else "1:1",
                )

            with self.subTest(failure=failure), self.assertRaises(RuntimeError):
                asyncio.run(self.image_provider_request(handler, generate))
            self.assertEqual(calls, [])

        for account, token in (
            ("", ""),
            ("../bad", "token"),
            ("a" * 32, ""),
            ("a" * 32, "bad\r\nheader"),
        ):
            with (
                self.subTest(account=account),
                patch.object(settings, "CLOUDFLARE_AI_ACCOUNT_ID", account),
                patch.object(settings, "CLOUDFLARE_AI_API_TOKEN", token),
                patch.object(httpx, "AsyncClient") as client,
            ):
                actual = runpy.run_path(
                    str(
                        Path(__file__).resolve().parents[1]
                        / "app/services/image_gen_service.py"
                    )
                )["image_gen_service"]
                self.assertIsNone(actual.client)
                client.assert_not_called()
                with self.assertRaisesRegex(RuntimeError, "not configured"):
                    asyncio.run(actual.generate_image("A tree"))

        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(200, json=self.image_provider_payload())

        with patch.object(
            media_service,
            "save_generated_image",
            side_effect=RuntimeError("private storage detail"),
        ) as save:
            with self.assertRaisesRegex(RuntimeError, "could not be saved") as error:
                asyncio.run(self.image_provider_request(handler))
        self.assertNotIn("private storage detail", str(error.exception))
        save.assert_called_once()
        self.assertEqual(len(calls), 1)

    def test_workers_ai_deadline_and_cancellation_stop_the_provider_request(self):
        from app.services.media_service import media_service

        async def exercise(cancel):
            entered, stopped = asyncio.Event(), asyncio.Event()

            async def slow(request):
                entered.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    stopped.set()

            async def generate(actual):
                task = asyncio.create_task(
                    actual.generate_image("A tree", "alice-session")
                )
                await entered.wait()
                if cancel:
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                else:
                    with self.assertRaisesRegex(RuntimeError, "timed out"):
                        await task
                self.assertTrue(stopped.is_set())

            await self.image_provider_request(slow, generate)

        with patch.object(media_service, "save_generated_image") as save:
            with patch.object(settings, "IMAGE_GENERATION_TIMEOUT_SECONDS", 0.05):
                asyncio.run(exercise(False))
            asyncio.run(exercise(True))
            save.assert_not_called()
        actual = self.reference_generator()
        client = actual.client
        client.aclose = AsyncMock()
        asyncio.run(actual.aclose())
        asyncio.run(actual.aclose())
        client.aclose.assert_awaited_once()
        self.assertIsNone(actual.client)

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
        with (
            patch.object(settings, "DATA_DIR", data),
            patch.object(storage_service, "_s3_client", client),
            patch.object(storage_service, "_initialized", True),
        ):
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
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("../../fixture.txt", b"fixture", "text/plain")},
            )
        self.assertEqual(response.status_code, 500)
        self.assertTrue(paths)
        self.assertTrue(all(not path.exists() for path in paths))

    def test_pdf_worker_preserves_page_numbers_and_chunk_citations(self):
        from app.services.pdf_service import extract_pdf_pages

        path = root / "extraction-fixture.pdf"
        path.write_bytes(
            self.pdf_fixture(
                "First page fixture text for indexing.",
                "",
                "Third page fixture text for indexing.",
            )
        )
        pages = extract_pdf_pages(path)
        self.assertEqual([number for _, number in pages], [1, 3])
        self.assertIn("Third page fixture", pages[1][0])
        embedding = types.ModuleType("app.services.embedding_service")
        embedder = Mock()
        embedder.embedding_space = "fixture-space"
        embedder.embed_batch.side_effect = lambda texts: [[1.0] for _ in texts]
        setattr(embedding, "embedding_service", embedder)
        with (
            patch.dict(sys.modules, {embedding.__name__: embedding}),
            patch.multiple(
                settings,
                CHUNK_SIZE=800,
                CHUNK_OVERLAP=150,
                TOP_K_RETRIEVAL=4,
                SIMILARITY_THRESHOLD=0.2,
                create=True,
            ),
        ):
            actual = runpy.run_path(
                str(Path(__file__).resolve().parents[1] / "app/services/rag_service.py")
            )["rag_service"]
        with patch.object(
            actual,
            "extract_text_from_file",
            side_effect=AssertionError("Do not parse twice"),
        ):
            metadata = actual.process_and_index_document(
                path,
                "fixture.pdf",
                "alice-session",
                self.alice.id,
                extracted_pages=pages,
            )
        self.assertEqual(metadata.total_chunks, 2)
        self.assertEqual(
            [
                item["page_number"]
                for item in vectors.add_chunks.call_args.kwargs["metadatas"]
            ],
            [1, 3],
        )
        from app.api.v1.endpoints import document

        with patch.object(document, "rag_service", actual):
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("fixture.pdf", path.read_bytes(), "application/pdf")},
            )
        self.assertEqual(response.status_code, 201)
        uploaded = response.json()["document"]
        self.assertEqual(uploaded["total_chunks"], 2)
        self.assertEqual(
            self.request(
                "GET", uploaded["storage_url"].removeprefix("/api/v1")
            ).content,
            path.read_bytes(),
        )

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
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://fixture.invalid",
            ) as client:
                upload = asyncio.create_task(
                    client.post(
                        "/api/v1/document/upload",
                        headers={"Authorization": "Bearer " + self.token},
                        data={"session_id": "alice-session"},
                        files={"file": ("fixture.pdf", b"fixture", "application/pdf")},
                    )
                )
                try:
                    for _ in range(100):
                        if started.is_set():
                            break
                        await asyncio.sleep(0.01)
                    self.assertTrue(started.is_set())
                    self.assertFalse(upload.done())
                    health = await asyncio.wait_for(
                        client.get("/api/v1/health"), timeout=1
                    )
                    self.assertEqual(health.status_code, 200)
                    self.assertFalse(upload.done())
                finally:
                    release.set()
                    response = await upload
                self.assertEqual(response.status_code, 422)

        with patch.object(
            document.rag_service, "extract_text_from_file", side_effect=wait_for_release
        ):
            asyncio.run(exercise())

    def test_pdf_worker_rejects_page_text_size_and_encryption_limits(self):
        from app.services.pdf_service import PDFProcessingError, extract_pdf_pages

        path = root / "limits-fixture.pdf"
        path.write_bytes(self.pdf_fixture("First fixture page", "Second fixture page"))
        for field, value in (
            ("PDF_MAX_PAGES", 1),
            ("PDF_MAX_TEXT_CHARS", 3),
            ("PDF_MAX_FILE_SIZE_BYTES", 3),
        ):
            with (
                self.subTest(limit=field),
                patch.object(settings, field, value),
                self.assertRaises(PDFProcessingError) as raised,
            ):
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
        with (
            patch.object(pdf_service, "_worker", script),
            patch.object(pdf_service, "_slots", slots),
            patch.object(settings, "PDF_PARSE_TIMEOUT_SECONDS", 0.1),
            self.assertRaises(pdf_service.PDFProcessingError) as raised,
        ):
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
        with (
            patch.object(pdf_service, "_slots", slots),
            patch.object(pdf_service.subprocess, "Popen") as spawn,
        ):
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
        with (
            patch.object(
                document.rag_service,
                "extract_text_from_file",
                side_effect=extract_pdf_pages,
            ),
            patch.object(document.rag_service, "process_and_index_document") as index,
            patch.object(storage_service, "upload_file") as upload,
        ):
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={
                    "file": ("malformed.pdf", b"invalid fixture", "application/pdf")
                },
            )
            self.assertEqual(response.status_code, 422)
            with patch.object(settings, "PDF_MAX_FILE_SIZE_BYTES", 3):
                response = self.request(
                    "POST",
                    "/document/upload",
                    self.token,
                    data={"session_id": "alice-session"},
                    files={
                        "file": ("large.pdf", b"oversized fixture", "application/pdf")
                    },
                )
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
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", code],
            capture_output=True,
            text=True,
            timeout=15,
        )
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
        with (
            patch.object(document.tempfile, "NamedTemporaryFile", return_value=manager),
            patch.object(document.rag_service, "process_and_index_document") as index,
        ):
            response = self.request(
                "POST",
                "/document/upload",
                self.token,
                data={"session_id": "alice-session"},
                files={"file": ("fixture.txt", b"fixture", "text/plain")},
            )
        self.assertEqual(response.status_code, 500)
        self.assertFalse(path.exists())
        index.assert_not_called()

    def test_document_attachments_are_persisted_and_route_to_grounding(self):
        from app.api.v1.endpoints import chat
        from app.services.rag_service import rag_service

        providers = {}
        for name, attribute in (
            ("llm_service", "llm_service"),
            ("image_gen_service", "image_gen_service"),
            ("web_search_service", "web_search_service"),
        ):
            stub = types.ModuleType("app.services." + name)
            setattr(stub, attribute, Mock())
            providers[stub.__name__] = stub
        with patch.dict(sys.modules, providers):
            implementation = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"
                )
            )
        actual = implementation["chat_orchestrator"]
        context = [
            {
                "text": "fixture document",
                "metadata": {"document_id": "document"},
                "similarity_score": 1.0,
            }
        ]

        async def grounded(query, session_id, history, **kwargs):
            self.assertEqual(kwargs["context_chunks"], context)
            yield 'data: {"event":"done","data":"[DONE]"}\n\n'

        async def vision(*args, **kwargs):
            raise AssertionError("Documents must not enter the vision route")
            yield ""

        with (
            patch.object(chat, "chat_orchestrator", actual),
            patch.object(actual, "_execute_document_rag", grounded),
            patch.object(actual, "_execute_multimodal", vision),
            patch.object(
                rag_service, "retrieve_context_for_query", return_value=context
            ) as retrieve,
        ):
            for mode in ("AUTO", "DOCUMENT_RAG", "MULTIMODAL"):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "library-target",
                        "message": "review",
                        "mode": mode,
                        "attachments": [
                            {
                                "id": "document",
                                "file_type": "document",
                                "url": "http://untrusted.invalid",
                            }
                        ],
                    },
                )
                self.assertEqual(response.status_code, 200)
                retrieve.assert_called_with(
                    "review", "library-target", document_ids=["document"]
                )
            response = self.request(
                "POST",
                "/chat/stream",
                self.token,
                json={
                    "session_id": "library-target",
                    "mode": "AUTO",
                    "message": "Which scientific concepts are covered by the document?",
                },
            )
            self.assertEqual(response.status_code, 200)
            retrieve.assert_called_with(
                "Which scientific concepts are covered by the document?",
                "library-target",
            )
        history = self.request(
            "GET", "/session/library-target/history", self.token
        ).json()
        attachment = history["messages"][0]["attachments"][0]
        self.assertEqual(attachment["file_type"], "document")
        self.assertEqual(attachment["file_name"], "fixture.txt")
        self.assertEqual(
            self.request("GET", attachment["url"].removeprefix("/api/v1")).content,
            b"fixture",
        )
        denied = self.request(
            "POST",
            "/chat/stream",
            self.other_token,
            json={
                "session_id": "bob-session",
                "message": "review",
                "attachments": [
                    {"id": "document", "file_type": "document", "url": "ignored"}
                ],
            },
        )
        self.assertEqual(denied.status_code, 404)

    def test_library_document_reference_survives_reload_clear_and_source_deletion(self):
        from app.repositories.session_store import SessionStoreRepository
        from app.schemas.chat import MediaAttachment
        from app.services.chat_history_service import chat_history_service

        security.ensure_session("library-target", self.principal)
        worker = SessionStoreRepository()
        cached = worker.get_or_create_session("library-target")
        self.assertEqual(cached.document_ids, [])
        attachment = MediaAttachment(id="document", file_type="document")
        for _ in range(2):
            chat_history_service.save_message(
                "library-target", "user", "Review", attachments=[attachment]
            )
        self.assertEqual(
            worker.get_or_create_session("library-target").document_ids, ["document"]
        )
        database.init_db()  # Repeatable migration must retain existing references.
        for repository in (worker, SessionStoreRepository()):
            self.assertEqual(
                repository.get_or_create_session("library-target").document_ids,
                ["document"],
            )
        history = self.request("GET", "/session/library-target/history", self.token)
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["documents"][0]["document_id"], "document")
        self.assertEqual(history.json()["session"]["document_count"], 1)
        self.assertEqual(
            self.request(
                "DELETE", "/session/library-target/messages", self.token
            ).status_code,
            200,
        )
        self.assertEqual(
            self.request("DELETE", "/session/alice-session", self.token).status_code,
            200,
        )
        self.assertEqual(
            worker.get_or_create_session("library-target").document_ids, ["document"]
        )
        with database.get_db_connection() as conn:
            document = conn.execute(
                "SELECT * FROM documents WHERE id='document'"
            ).fetchone()
            self.assertIsNone(document["session_id"])
            self.assertEqual(document["user_id"], self.alice.id)
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM session_documents").fetchone()[0], 1
            )

    def test_deleting_referencing_chat_preserves_original_document_and_vectors(self):
        from app.schemas.chat import MediaAttachment
        from app.services.chat_history_service import chat_history_service

        security.ensure_session("library-target", self.principal)
        chat_history_service.save_message(
            "library-target",
            "user",
            "Review",
            attachments=[MediaAttachment(id="document", file_type="document")],
        )
        with patch.object(vectors, "delete_document") as delete:
            response = self.request("DELETE", "/session/library-target", self.token)
        self.assertEqual(response.status_code, 200)
        delete.assert_not_called()
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT session_id FROM documents WHERE id='document'"
                ).fetchone()[0],
                "alice-session",
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM session_documents").fetchone()[0], 0
            )
        self.assertTrue((root / "documents/alice-session/fixture.txt").exists())

    def test_invalid_library_reference_rolls_back_message_and_all_links(self):
        from fastapi import HTTPException

        from app.schemas.chat import MediaAttachment
        from app.services.chat_history_service import chat_history_service

        security.ensure_session("library-target", self.principal)
        security.ensure_session(
            "bob-session", security.resolve_principal(security.digest(self.other_token))
        )
        with database.get_db_connection() as conn:
            conn.execute(
                "INSERT INTO documents (id,user_id,session_id,filename,file_type,file_size_bytes,total_chunks,storage_url,created_at) SELECT 'foreign-document',?,'bob-session',filename,"
                "file_type,file_size_bytes,total_chunks,storage_url,created_at "
                "FROM documents WHERE id='document'",
                (self.bob.id,),
            )
        for invalid in ("missing", "foreign-document"):
            with self.assertRaises(HTTPException) as error:
                chat_history_service.save_message(
                    "library-target",
                    "user",
                    "Review",
                    attachments=[
                        MediaAttachment(id=key, file_type="document")
                        for key in ("document", invalid)
                    ],
                )
            self.assertEqual(error.exception.status_code, 404)
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM session_documents").fetchone()[0], 0
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 0
            )

    def test_deleted_or_expired_source_document_leaves_retrieval_scope_in_all_workers(
        self,
    ):
        from app.repositories.session_store import SessionStoreRepository
        from app.schemas.chat import MediaAttachment
        from app.services.chat_history_service import chat_history_service

        security.ensure_session("library-target", self.principal)
        chat_history_service.save_message(
            "library-target",
            "user",
            "Review",
            attachments=[MediaAttachment(id="document", file_type="document")],
        )
        worker = SessionStoreRepository()
        self.assertEqual(
            worker.get_or_create_session("library-target").document_ids, ["document"]
        )
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE chat_sessions SET expires_at='2000-01-01T00:00:00' WHERE id='alice-session'"
            )
        for repository in (worker, SessionStoreRepository()):
            self.assertEqual(
                repository.get_or_create_session("library-target").document_ids, []
            )
        chat_history_service.delete_document("document")
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM session_documents").fetchone()[0], 0
            )
        self.assertEqual(
            worker.get_or_create_session("library-target").document_ids, []
        )

    def test_temporary_source_expiry_removes_document_references_from_normal_chat(self):
        from app.repositories.session_store import SessionStoreRepository
        from app.schemas.chat import MediaAttachment
        from app.services import session_lifecycle
        from app.services.chat_history_service import chat_history_service

        security.ensure_session("library-target", self.principal)
        chat_history_service.save_message(
            "library-target",
            "user",
            "Review",
            attachments=[MediaAttachment(id="document", file_type="document")],
        )
        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE chat_sessions SET is_temporary=1,expires_at='2000-01-01T00:00:00' "
                "WHERE id='alice-session'"
            )
        self.assertEqual(session_lifecycle.purge_expired_sessions(), 1)
        self.assertEqual(
            SessionStoreRepository()
            .get_or_create_session("library-target")
            .document_ids,
            [],
        )
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM session_documents").fetchone()[0], 0
            )
            self.assertIsNone(
                conn.execute("SELECT id FROM documents WHERE id='document'").fetchone()
            )

    def test_grounding_honors_explicit_document_selection(self):
        from app.schemas.chat import MediaAttachment
        from app.services.chat_history_service import chat_history_service

        security.ensure_session("library-target", self.principal)
        chat_history_service.save_message(
            "library-target",
            "user",
            "Review",
            attachments=[MediaAttachment(id="document", file_type="document")],
        )
        chat_history_service.save_document(
            "selected-fixture",
            self.alice.id,
            "alice-session",
            "selected.txt",
            "txt",
            4,
            1,
            embedding_space="fixture-space",
        )
        embedding = types.ModuleType("app.services.embedding_service")
        embedder = Mock()
        embedder.embedding_space = "fixture-space"
        embedder.embed_text.return_value = [1.0]
        setattr(embedding, "embedding_service", embedder)
        with (
            patch.dict(sys.modules, {embedding.__name__: embedding}),
            patch.multiple(
                settings,
                CHUNK_SIZE=800,
                CHUNK_OVERLAP=150,
                TOP_K_RETRIEVAL=4,
                SIMILARITY_THRESHOLD=0.2,
                create=True,
            ),
        ):
            implementation = runpy.run_path(
                str(Path(__file__).resolve().parents[1] / "app/services/rag_service.py")
            )
            actual = implementation["rag_service"]
            with patch.object(vectors, "similarity_search", return_value=[]) as search:
                self.assertEqual(
                    actual.retrieve_context_for_query(
                        "review", "alice-session", document_ids=["selected-fixture"]
                    ),
                    [],
                )
                self.assertEqual(
                    search.call_args.kwargs["document_ids"], ["selected-fixture"]
                )
                search.reset_mock()
                self.assertEqual(
                    actual.retrieve_context_for_query(
                        "review", "alice-session", document_ids=[]
                    ),
                    [],
                )
                search.assert_not_called()
                actual.retrieve_context_for_query("follow-up", "library-target")
                self.assertEqual(search.call_args.kwargs["document_ids"], ["document"])

    def test_real_orchestrator_streams_owned_media_without_external_requests(self):
        from app.api.v1.endpoints import chat
        from app.services.media_service import media_service

        async def answer(*args, **kwargs):
            yield "Offline answer"

        async def vision(*args, **kwargs):
            self.assertEqual(
                media_service.get_media_bytes(kwargs["attachments"][0].url),
                b"fixture-image",
            )
            yield "Offline vision"

        providers = {}
        for name, attribute in (
            ("llm_service", "llm_service"),
            ("image_gen_service", "image_gen_service"),
            ("web_search_service", "web_search_service"),
        ):
            stub = types.ModuleType("app.services." + name)
            setattr(
                stub,
                attribute,
                Mock(
                    stream_conversational_answer=answer, stream_multimodal_answer=vision
                ),
            )
            providers[stub.__name__] = stub
        with patch.dict(sys.modules, providers):
            implementation = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"
                )
            )
        with patch.object(
            chat, "chat_orchestrator", implementation["chat_orchestrator"]
        ):
            for mode, attachments, expected in (
                ("AUTO", [], "Offline answer"),
                (
                    "MULTIMODAL",
                    [
                        {
                            "id": "image",
                            "file_type": "image",
                            "url": "http://internal.invalid",
                        }
                    ],
                    "Offline vision",
                ),
            ):
                response = self.request(
                    "POST",
                    "/chat/stream",
                    self.token,
                    json={
                        "session_id": "alice-session",
                        "message": "hello",
                        "mode": mode,
                        "attachments": attachments,
                    },
                )
                self.assertEqual(response.status_code, 200)
                self.assertIn(expected, response.text)
                self.assertNotIn('"event": "error"', response.text)

    def test_production_spa_serves_build_and_blocks_private_paths(self):
        distribution = root / "frontend/dist"
        distribution.mkdir(parents=True, exist_ok=True)
        (distribution / "index.html").write_text("fixture frontend", encoding="utf-8")
        (distribution / "public.txt").write_text(
            "fixture public file", encoding="utf-8"
        )
        assets = distribution / "assets"
        assets.mkdir(exist_ok=True)
        (assets / "main.js").write_text("fixture asset", encoding="utf-8")
        (root / "private-fixture.txt").write_text("private fixture", encoding="utf-8")
        production = runpy.run_path(
            str(Path(__file__).resolve().parents[1] / "app/main.py")
        )["app"]

        async def check():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=production),
                base_url="http://fixture.invalid",
            ) as client:
                self.assertEqual(
                    (await client.get("/c/alice-session")).text, "fixture frontend"
                )
                self.assertEqual(
                    (await client.get("/public.txt")).text, "fixture public file"
                )
                self.assertEqual(
                    (await client.get("/assets/main.js")).text, "fixture asset"
                )
                for path in (
                    "/%2e%2e/%2e%2e/private-fixture.txt",
                    "/..%5c..%5cprivate-fixture.txt",
                    "/assets/..%5c..%5c..%5cprivate-fixture.txt",
                    "/api",
                    "/api/",
                    "/api/v1/not-a-route",
                    "/api%5cv1%5cnot-a-route",
                    "/%2e/api",
                    "/other/%2e%2e/api",
                    "/api/v1/media/uploads/fixture.png",
                    "/docs/not-a-route",
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
        production = runpy.run_path(
            str(Path(__file__).resolve().parents[1] / "app/main.py")
        )["app"]

        async def check():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=production),
                base_url="http://fixture.invalid",
            ) as client:
                for path in (
                    f"/{link_name}/private.txt",
                    f"/assets/{link_name}/private.txt",
                ):
                    with self.subTest(path=path):
                        response = await client.get(path)
                        self.assertEqual(response.status_code, 404)
                        self.assertNotIn("private fixture", response.text)

        asyncio.run(check())

    def test_direct_email_google_login_is_rejected(self):
        self.assertEqual(
            self.request(
                "POST", "/user/auth/google", json={"email": self.alice.email}
            ).status_code,
            422,
        )

    def test_profile_and_upload_identity_cannot_be_overridden(self):
        for method, path, kwargs in (
            (
                "PATCH",
                "/user/profile",
                {"json": {"user_id": self.alice.id, "display_name": "Attacker"}},
            ),
            (
                "POST",
                "/media/upload",
                {
                    "data": {"user_id": self.alice.id},
                    "files": {"file": ("fixture.png", b"fixture", "image/png")},
                },
            ),
            (
                "POST",
                "/document/upload",
                {
                    "data": {"session_id": "alice-session"},
                    "files": {"file": ("fixture.txt", b"fixture")},
                },
            ),
        ):
            with self.subTest(path=path):
                self.assertIn(
                    self.request(method, path, self.other_token, **kwargs).status_code,
                    (403, 404),
                )

    def test_guest_document_metadata_has_owned_downloads(self):
        from app.services.chat_history_service import chat_history_service

        guest = security.create_guest()
        principal = security.resolve_principal(security.digest(guest["access_token"]))
        security.ensure_session("guest-document-session", principal)
        chat_history_service.save_document(
            "guest-document",
            principal.user_id,
            "guest-document-session",
            "fixture.txt",
            "txt",
            7,
            1,
            "documents/alice-session/fixture.txt",
        )
        url = security.download_url(
            "guest-document", principal, "document"
        ).removeprefix("/api/v1")
        self.assertEqual(self.request("GET", url).content, b"fixture")
        self.assertEqual(
            self.request(
                "GET", "/document/guest-document/chunks", self.token
            ).status_code,
            404,
        )

    def test_unowned_legacy_assets_are_denied_and_missing_attachments_do_not_break_history(
        self,
    ):
        from app.services.chat_history_service import chat_history_service

        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE media_assets SET user_id=NULL,session_id=NULL WHERE id='image'"
            )
        self.assertEqual(
            self.request("GET", "/media/content/media/image", self.token).status_code,
            404,
        )
        chat_history_service.save_message(
            "alice-session", "user", "Old message", attachments=[{"url": "/legacy.png"}]
        )
        response = self.request("GET", "/session/alice-session/history", self.token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["messages"][0]["attachments"], [])

    def test_legacy_generated_asset_derives_owner_from_session(self):
        with database.get_db_connection() as conn:
            conn.execute("UPDATE media_assets SET user_id=NULL WHERE id='image'")
        response = self.request("GET", "/media/assets", self.token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 2)
        self.assertEqual(
            self.request("GET", "/media/content/media/image", self.token).content,
            b"fixture-image",
        )

    def test_verified_google_subject_is_persistent_and_client_email_is_ignored(self):
        import app.services.user_service as service_module

        claims = {
            "sub": "google-fixture",
            "email": "new@gmail.com",
            "name": "Google Person",
            "email_verified": True,
        }
        with patch.object(
            service_module, "verify_google_credential", return_value=claims
        ):
            first = self.request(
                "POST",
                "/user/auth/google",
                json={"credential": "verified-by-fixture", "email": self.alice.email},
            )
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["email"], "new@gmail.com")
            claims["email"] = "changed@gmail.com"
            second = self.request(
                "POST", "/user/auth/google", json={"credential": "verified-by-fixture"}
            )
            self.assertEqual(second.json()["id"], first.json()["id"])

    def test_third_party_email_cannot_automatically_link_to_existing_account(self):
        import app.services.user_service as service_module

        claims = {
            "sub": "google-fixture",
            "email": self.alice.email,
            "email_verified": True,
        }
        with patch.object(
            service_module, "verify_google_credential", return_value=claims
        ):
            self.assertEqual(
                self.request(
                    "POST",
                    "/user/auth/google",
                    json={"credential": "verified-by-fixture"},
                ).status_code,
                409,
            )

    def test_cloud_file_download_uses_exact_owned_key_without_http_fallback(self):
        from app.services.storage_service import storage_service

        with database.get_db_connection() as conn:
            conn.execute(
                "UPDATE media_assets SET file_path='media/uploads/cloud-fixture.png' WHERE id='image'"
            )
        body = io.BytesIO(b"cloud fixture")
        client = Mock()
        client.get_object.return_value = {"Body": body}
        with (
            patch.object(storage_service, "_s3_client", client),
            patch.object(storage_service, "_initialized", True),
        ):
            response = self.request("GET", "/media/content/media/image", self.token)
        self.assertEqual(response.content, b"cloud fixture")
        client.get_object.assert_called_once_with(
            Bucket="fixture", Key="media/uploads/cloud-fixture.png"
        )
        self.assertTrue(body.closed)

    def test_generated_stream_media_gets_an_owned_download_ticket(self):
        fixture_orchestrator.emit_media = True
        response = self.request(
            "POST",
            "/chat/stream",
            self.token,
            json={"session_id": "alice-session", "message": "hello"},
        )
        event = json.loads(response.text.split("\n\n")[0].removeprefix("data: "))
        url = event["media"]["url"].removeprefix("/api/v1")
        self.assertEqual(self.request("GET", url).content, b"fixture-image")

    def test_storage_reads_reject_urls_paths_and_unsafe_keys_before_r2(self):
        from app.services.storage_service import storage_service

        private = root / "private-read-fixture.txt"
        private.write_bytes(b"private fixture")
        client = Mock()
        keys = [
            "",
            str(private),
            "../private-read-fixture.txt",
            "media/../private-read-fixture.txt",
            "media//uploads/fixture.png",
            r"media\uploads\fixture.png",
            "media/uploads/CON.txt",
            "media/uploads/fixture.png:stream",
            "media/uploads/fixture.png.",
            "private-read-fixture.txt",
            "http://127.0.0.1/private",
            "http://169.254.169.254/latest/meta-data/",
            "file:///private",
            "//internal.invalid/media/uploads/fixture.png",
        ]
        with (
            patch.object(storage_service, "_s3_client", client),
            patch.object(storage_service, "_initialized", True),
        ):
            for key in keys:
                with self.subTest(key=key):
                    self.assertIsNone(storage_service.download_owned_file(key))
                    self.assertIsNone(storage_service.download_file(key))
            client.get_object.assert_not_called()

    def test_storage_url_resolution_requires_exact_configured_origin_and_prefix(self):
        from app.services.storage_service import storage_service

        key = "media/uploads/fixture.png"
        with (
            patch.object(
                settings,
                "CLOUDFLARE_R2_PUBLIC_URL",
                "https://cdn.fixture.invalid/files",
            ),
            patch.object(settings, "r2_endpoint_url", "https://r2.fixture.invalid"),
            patch.object(
                storage_service, "download_owned_file", return_value=b"fixture"
            ) as read,
        ):
            for url in (
                "https://cdn.fixture.invalid/files/" + key,
                "https://r2.fixture.invalid/fixture/" + key,
                "/api/v1/media/uploads/fixture.png?ticket=fixture",
            ):
                self.assertEqual(storage_service.download_file(url), b"fixture")
                read.assert_called_with(key)
            for url in (
                "https://cdn.fixture.invalid.evil.invalid/files/" + key,
                "https://evil.invalid/fixture/" + key,
                "https://evil.invalid/https://cdn.fixture.invalid/files/" + key,
                "https://cdn.fixture.invalid/filesevil/" + key,
                "https://cdn.fixture.invalid:444/files/" + key,
                "https://user@cdn.fixture.invalid/files/" + key,
                "https://cdn.fixture.invalid/files/media/%2e%2e/private.txt",
            ):
                self.assertIsNone(storage_service._extract_key_from_url(url))
                with self.assertRaises(security.HTTPException):
                    storage_service.owned_storage_key({"file_path": url}, "media")

    def test_owned_downloads_bound_reads_and_close_cloud_bodies(self):
        from app.services.storage_service import storage_service

        self.assertIsNone(
            storage_service.download_owned_file(
                "media/uploads/fixture.png", max_bytes=3
            )
        )
        self.assertEqual(
            storage_service.download_owned_file(
                "media/uploads/fixture.png", max_bytes=13
            ),
            b"fixture-image",
        )
        for declared in (0, 100):
            body = io.BytesIO(b"oversized fixture")
            client = Mock()
            client.get_object.return_value = {"Body": body, "ContentLength": declared}
            with (
                patch.object(storage_service, "_s3_client", client),
                patch.object(storage_service, "_initialized", True),
            ):
                self.assertIsNone(
                    storage_service.download_owned_file(
                        "media/uploads/cloud-limit.png", max_bytes=3
                    )
                )
            self.assertTrue(body.closed)

    def test_cloud_failure_never_falls_back_to_http(self):
        from app.services.storage_service import storage_service

        client = Mock()
        client.get_object.side_effect = RuntimeError("fixture storage failure")
        with (
            patch.object(storage_service, "_s3_client", client),
            patch.object(storage_service, "_initialized", True),
            patch.object(
                settings, "CLOUDFLARE_R2_PUBLIC_URL", "https://cdn.fixture.invalid"
            ),
            patch.object(
                httpx,
                "Client",
                side_effect=AssertionError("HTTP fallback is forbidden"),
            ),
        ):
            self.assertIsNone(
                storage_service.download_file(
                    "https://cdn.fixture.invalid/media/uploads/cloud-missing.png"
                )
            )
        client.get_object.assert_called_once_with(
            Bucket="fixture", Key="media/uploads/cloud-missing.png"
        )

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
        with (
            patch.object(settings, "DATA_DIR", data),
            patch.object(storage_service, "_s3_client", client),
            patch.object(storage_service, "_initialized", True),
        ):
            self.assertIsNone(
                storage_service.download_owned_file("media/linked/fixture.txt")
            )
            client.get_object.assert_not_called()

    def test_vision_reads_only_media_keys_with_the_upload_size_limit(self):
        from app.services import media_service as implementation
        from app.services.storage_service import storage_service

        with patch.object(implementation, "MAX_FILE_SIZE_BYTES", 3):
            self.assertIsNone(
                implementation.media_service.get_media_bytes(
                    "media/uploads/fixture.png"
                )
            )
        with patch.object(storage_service, "download_owned_file") as read:
            self.assertIsNone(
                implementation.media_service.get_media_bytes(
                    "documents/alice-session/fixture.txt"
                )
            )
            self.assertIsNone(
                implementation.media_service.get_media_bytes("http://internal.invalid")
            )
            read.assert_not_called()

    def test_reference_generation_uses_owned_keys_in_local_and_cloud_modes(self):
        from app.api.v1.endpoints import chat
        from app.schemas.chat import MediaAttachment
        from app.services.media_service import media_service
        from app.services.storage_service import storage_service

        async def reference(**kwargs):
            self.assertTrue(kwargs["reference_image_path"].startswith("media/uploads/"))
            self.assertEqual(
                media_service.get_media_bytes(kwargs["reference_image_path"]),
                b"fixture-image",
            )
            return MediaAttachment(id="image", url="ignored", file_type="image")

        providers = {}
        for name in ("llm_service", "image_gen_service", "web_search_service"):
            stub = types.ModuleType("app.services." + name)
            setattr(stub, name, Mock())
            providers[stub.__name__] = stub
        generator = getattr(
            providers["app.services.image_gen_service"], "image_gen_service"
        )
        generator.generate_from_reference = AsyncMock(side_effect=reference)
        generator.generate_image = AsyncMock(
            side_effect=AssertionError("Must use the attached reference")
        )
        with patch.dict(sys.modules, providers):
            actual = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1] / "app/services/orchestrator.py"
                )
            )["chat_orchestrator"]
        client = Mock()
        client.get_object.side_effect = lambda **kwargs: {
            "Body": io.BytesIO(b"fixture-image")
        }
        with (
            patch.object(chat, "chat_orchestrator", actual),
            patch.object(storage_service, "_s3_client", client),
        ):
            for cloud in (False, True):
                key = (
                    "media/uploads/cloud-reference.png"
                    if cloud
                    else "media/uploads/fixture.png"
                )
                with database.get_db_connection() as conn:
                    conn.execute(
                        "UPDATE media_assets SET file_path=? WHERE id='image'", (key,)
                    )
                with patch.object(storage_service, "_initialized", cloud):
                    response = self.request(
                        "POST",
                        "/chat/stream",
                        self.token,
                        json={
                            "session_id": "alice-session",
                            "message": "Generate a new image using this reference",
                            "mode": "IMAGE_GENERATION",
                            "attachments": [
                                {
                                    "id": "image",
                                    "file_type": "image",
                                    "url": "http://internal.invalid",
                                }
                            ],
                        },
                    )
                self.assertEqual(response.status_code, 200)
                self.assertNotIn('"event": "error"', response.text)
                self.assertIn('"event": "media"', response.text)
        self.assertEqual(generator.generate_from_reference.await_count, 2)
        generator.generate_image.assert_not_called()

    def test_incoming_attachment_url_is_replaced_with_owned_storage_key(self):
        response = self.request(
            "POST",
            "/chat/stream",
            self.token,
            json={
                "session_id": "alice-session",
                "message": "hello",
                "attachments": [
                    {
                        "id": "image",
                        "file_type": "image",
                        "url": "http://internal.invalid/secret",
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        assert fixture_orchestrator.last_request is not None
        self.assertEqual(
            fixture_orchestrator.last_request.attachments[0].url,
            "media/uploads/fixture.png",
        )

    def issue_otp(self, purpose="login", delivered=True):
        from app.services import user_service as service_module

        sender = AsyncMock(return_value=delivered)
        method = (
            "send_otp_email" if purpose == "login" else "send_password_reset_otp_email"
        )
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
                    row = conn.execute(
                        "SELECT attempts,is_used,otp_code FROM email_otps"
                    ).fetchone()
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
            self.assertEqual(
                conn.execute(
                    "SELECT is_used FROM email_otps WHERE purpose='reset'"
                ).fetchone()[0],
                1,
            )

    def test_failed_email_is_reported_and_cannot_authenticate(self):
        failed, code = self.issue_otp(delivered=False)
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(self.verify_otp(code).status_code, 400)
        with database.get_db_connection() as conn:
            row = conn.execute(
                "SELECT delivery_status,is_used FROM email_otps"
            ).fetchone()
            self.assertEqual((row[0], row[1]), ("failed", 1))
        self.assertEqual(self.issue_otp()[0].status_code, 429)

    def test_send_budget_shared_by_login_reset_and_used_codes(self):
        for i in range(settings.OTP_MAX_SENDS_PER_HOUR):
            response, _ = self.issue_otp("login" if i % 2 == 0 else "reset")
            self.assertEqual(response.status_code, 200)
            with database.get_db_connection() as conn:
                conn.execute(
                    "UPDATE email_otps SET requested_at = requested_at - 31, is_used = 1"
                )
        self.assertEqual(self.issue_otp()[0].status_code, 429)

    def test_pending_email_cannot_authenticate_and_delivery_is_awaited(self):
        from app.services import user_service as service_module

        async def delivery(**kwargs):
            from fastapi import HTTPException

            with self.assertRaises(HTTPException):
                user_service.verify_login_otp("alice", kwargs["otp_code"])
            return True

        with patch.object(service_module.email_service, "send_otp_email", delivery):
            result = self.request(
                "POST", "/user/otp/send", json={"email_or_username": "alice"}
            )
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
            original = conn.execute(
                "SELECT password_hash FROM users WHERE id=?", (self.alice.id,)
            ).fetchone()[0]
            conn.execute(
                "CREATE TRIGGER reject_password BEFORE UPDATE OF password_hash ON users "
                "BEGIN SELECT RAISE(ABORT, 'fixture update failure'); END"
            )
        with self.assertRaises(Exception):
            self.verify_otp(code, "reset")
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT is_used FROM email_otps").fetchone()[0], 0
            )
            self.assertEqual(
                conn.execute(
                    "SELECT password_hash FROM users WHERE id=?", (self.alice.id,)
                ).fetchone()[0],
                original,
            )
            conn.execute("DROP TRIGGER reject_password")
        self.assertEqual(self.verify_otp(code, "reset").status_code, 200)

    def test_multi_statement_failure_rolls_back_inserts(self):
        with self.assertRaises(Exception):
            with database.get_db_connection() as conn:
                conn.execute(
                    "INSERT INTO email_otps(id,email,otp_code,expires_at,created_at) "
                    "VALUES('rollback-fixture','fixture@example.invalid','unused',0,'fixture')"
                )
                conn.execute(
                    "INSERT INTO email_otps(id,email,otp_code,expires_at,created_at) "
                    "VALUES('broken-fixture',NULL,'unused',0,'fixture')"
                )
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM email_otps").fetchone()[0], 0
            )

    def test_legacy_otp_migration_revokes_codes_and_is_repeatable(self):
        with database.get_db_connection() as conn:
            conn.execute("DROP INDEX idx_otp_email_requested")
            for name in ("purpose", "delivery_status", "requested_at"):
                conn.execute(f"ALTER TABLE email_otps DROP COLUMN {name}")
            conn.execute(
                "INSERT INTO email_otps(id,email,otp_code,expires_at,created_at) "
                "VALUES('legacy-fixture',?,'123456',?,'fixture')",
                (self.alice.email, time.time() + 300),
            )
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
            rows = conn.execute(
                "SELECT purpose,is_used FROM email_otps ORDER BY requested_at"
            ).fetchall()
            self.assertEqual(
                [(row[0], row[1]) for row in rows],
                [("login", 1), ("reset", 0), ("login", 0)],
            )
        self.assertEqual(self.verify_otp(latest_code).status_code, 200)

    def test_delivery_exception_is_redacted_and_challenge_revoked(self):
        from app.services import user_service as service_module

        sender = AsyncMock(
            side_effect=RuntimeError("sensitive fixture provider response")
        )
        with (
            patch.object(service_module.email_service, "send_otp_email", sender),
            patch.object(service_module.logger, "error") as log,
        ):
            result = self.request(
                "POST", "/user/otp/send", json={"email_or_username": "alice"}
            )
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("sensitive fixture", str(log.call_args))
        with database.get_db_connection() as conn:
            self.assertEqual(
                conn.execute("SELECT delivery_status FROM email_otps").fetchone()[0],
                "failed",
            )


class BlockingWorkerTests(unittest.TestCase):
    def test_model_clients_configure_finite_request_timeouts(self):
        from google import genai

        for name in ("embedding_service", "llm_service"):
            with (
                self.subTest(service=name),
                patch.object(settings, "GEMINI_API_KEY", "fixture-key"),
                patch.object(
                    settings, "DEFAULT_LLM_MODEL", "fixture-model", create=True
                ),
                patch.object(genai, "Client") as client,
            ):
                runpy.run_path(
                    str(Path(__file__).resolve().parents[1] / f"app/services/{name}.py")
                )
                client.assert_called_once_with(
                    api_key="fixture-key", http_options={"timeout": 60_000}
                )

    def test_embedding_batch_keeps_sdk_arguments_and_rejects_incomplete_results(self):
        from google import genai

        from app.core.concurrency import run_blocking

        with (
            patch.object(settings, "GEMINI_API_KEY", "fixture-key"),
            patch.object(
                settings, "DEFAULT_EMBEDDING_MODEL", "fixture-model", create=True
            ),
            patch.object(settings, "EMBEDDING_DIMENSION", 3, create=True),
            patch.object(genai, "Client") as client,
        ):
            service = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1]
                    / "app/services/embedding_service.py"
                )
            )["embedding_service"]
            embed = client.return_value.models.embed_content
            vectors = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
            embed.return_value = types.SimpleNamespace(
                embeddings=[types.SimpleNamespace(values=v) for v in vectors]
            )
            self.assertEqual(
                asyncio.run(run_blocking(service.embed_batch, ["one", "two"])), vectors
            )
            self.assertEqual(embed.call_args.kwargs["contents"], ["one", "two"])
            self.assertEqual(embed.call_args.kwargs["config"].output_dimensionality, 3)
            for payload in (None, [], [types.SimpleNamespace(values=None)] * 2):
                with self.subTest(payload=payload):
                    embed.return_value = types.SimpleNamespace(embeddings=payload)
                    from app.core.errors import EmbeddingError

                    with self.assertRaises(EmbeddingError):
                        asyncio.run(run_blocking(service.embed_batch, ["one", "two"]))

    def test_embedding_provider_failures_invalid_vectors_and_model_changes_are_explicit(
        self,
    ):
        from google import genai

        from app.core.errors import EmbeddingError

        with patch.object(genai, "Client") as client:
            service_type = runpy.run_path(
                str(
                    Path(__file__).resolve().parents[1]
                    / "app/services/embedding_service.py"
                )
            )["EmbeddingService"]
            with patch.object(settings, "GEMINI_API_KEY", "fixture-key"):
                service = service_type()
            embed = client.return_value.models.embed_content
            embed.side_effect = RuntimeError("private credential detail")
            with self.assertRaises(EmbeddingError) as caught:
                service.embed_batch(["test"])
            self.assertNotIn("private", str(caught.exception))

            class ConfigurationFailure(RuntimeError):
                def __init__(self, code):
                    super().__init__("private credential detail")
                    self.code = code

            for code in (401, 403, 404):
                embed.side_effect = ConfigurationFailure(code)
                with (
                    self.subTest(code=code),
                    self.assertRaisesRegex(EmbeddingError, "contact support"),
                ):
                    service.embed_text("test")
            embed.side_effect = None
            for values in (
                [1.0],
                [0.0, 0.0],
                [float("nan"), 1.0],
                [float("inf"), 1.0],
                None,
            ):
                embed.return_value = types.SimpleNamespace(
                    embeddings=[types.SimpleNamespace(values=values)]
                )
                with self.subTest(values=values), self.assertRaises(EmbeddingError):
                    service.embed_batch(["test"])
            service.client = None
            with self.assertRaises(EmbeddingError):
                service.embed_text("test")
            self.assertEqual(service.embed_batch([]), [])
            original = service.embedding_space
            for attribute, value in (
                ("DEFAULT_EMBEDDING_MODEL", "other-model"),
                ("EMBEDDING_DIMENSION", 3),
            ):
                with patch.object(settings, attribute, value):
                    self.assertNotEqual(service_type().embedding_space, original)
            self.assertEqual(service_type().embedding_space, original)

    def test_worker_limit_context_and_queued_cancellation(self):
        import threading
        from contextvars import ContextVar

        from anyio import to_thread

        from app.core.concurrency import run_blocking

        marker = ContextVar("worker_fixture", default="missing")
        release, started = threading.Event(), threading.Event()
        active = 0
        maximum = 0
        lock = threading.Lock()

        def operation():
            nonlocal active, maximum
            with lock:
                active += 1
                maximum = max(maximum, active)
                if active == 2:
                    started.set()
            try:
                if not release.wait(5):
                    raise AssertionError("Workers were not released")
                return marker.get()
            finally:
                with lock:
                    active -= 1

        async def exercise():
            limiter = to_thread.current_default_thread_limiter()
            previous = limiter.total_tokens
            limiter.total_tokens = 2
            marker.set("propagated")
            tasks = [asyncio.create_task(run_blocking(operation)) for _ in range(4)]
            never_called = Mock()
            queued = asyncio.create_task(run_blocking(never_called))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 3))
                self.assertEqual(limiter.borrowed_tokens, 2)
                queued.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await queued
                never_called.assert_not_called()
                self.assertEqual(maximum, 2)
            finally:
                release.set()
                results = await asyncio.gather(*tasks)
                limiter.total_tokens = previous
            self.assertEqual(results, ["propagated"] * 4)
            self.assertEqual(maximum, 2)
            never_called.assert_not_called()
            with self.assertRaisesRegex(ValueError, "fixture"):
                await run_blocking(Mock(side_effect=ValueError("fixture")))

        asyncio.run(exercise())

    def test_cancelled_scope_waits_for_started_worker(self):
        import threading

        from anyio import CancelScope, create_task_group

        from app.core.concurrency import run_blocking

        started, release = threading.Event(), threading.Event()
        finished, returned = threading.Event(), threading.Event()
        scopes = []

        def operation():
            started.set()
            if not release.wait(5):
                raise AssertionError("Worker was not released")
            finished.set()

        async def exercise():
            async def request():
                with CancelScope() as scope:
                    scopes.append(scope)
                    try:
                        await run_blocking(operation)
                    finally:
                        self.assertTrue(finished.is_set())
                        returned.set()

            async with create_task_group() as group:
                group.start_soon(request)
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 3))
                    scopes[0].cancel()
                    await asyncio.sleep(0.02)
                    self.assertFalse(returned.is_set())
                finally:
                    release.set()
            self.assertTrue(returned.is_set())

        asyncio.run(exercise())


class WebSearchTests(unittest.TestCase):
    def setUp(self):
        namespace = runpy.run_path(
            str(
                Path(__file__).resolve().parents[1]
                / "app/services/web_search_service.py"
            )
        )
        self.service = namespace["web_search_service"]
        self.requests = namespace["requests"]
        self.adapter_mocks = {}
        self.result = {
            "title": "Fixture source",
            "url": "https://example.invalid/article",
            "snippet": "Fixture evidence",
        }

    def adapters(self, google, bing, duck):
        for name, value in zip(
            ("_fetch_google_live_articles", "_search_bing", "_search_duckduckgo"),
            (google, bing, duck),
        ):
            replacement = patch.object(
                self.service,
                name,
                **(
                    {"side_effect": value}
                    if isinstance(value, BaseException)
                    else {"return_value": value}
                ),
            )
            mock = replacement.start()
            self.addCleanup(replacement.stop)
            self.adapter_mocks[name[1:]] = mock

    def test_no_results_are_empty_and_total_failure_is_explicit(self):
        from app.core.errors import WebSearchError

        self.adapters([], [], [])
        self.assertEqual(self.service.search("fixture"), [])
        for name in ("fetch_google_live_articles", "search_bing", "search_duckduckgo"):
            self.adapter_mocks[name].side_effect = self.requests.Timeout(
                "private fixture URL"
            )
        with self.assertRaises(WebSearchError) as caught:
            self.service.search("fixture")
        self.assertNotIn("private", str(caught.exception))

    def test_partial_failure_keeps_real_evidence_without_inventing_sources(self):
        self.adapters(self.requests.Timeout(), [self.result], [])
        self.assertEqual(self.service.search("fixture"), [self.result])
        self.adapter_mocks["search_duckduckgo"].assert_not_called()

    def test_invalid_primary_results_allow_fallback_and_dedup_uses_urls(self):
        self.adapters(
            [dict(self.result, url="javascript:alert(1)")],
            [],
            [
                self.result,
                dict(self.result, url=self.result["url"] + "#anchor"),
                dict(self.result, url="https://example.invalid/second"),
            ],
        )
        results = self.service.search("fixture", 2)
        self.assertEqual(
            [r["url"] for r in results],
            [self.result["url"], "https://example.invalid/second"],
        )
        self.adapter_mocks["search_duckduckgo"].assert_called_once()

    def test_normalization_rejects_unsafe_links_and_headlines_without_excerpts(self):
        for url in (
            "javascript:alert(1)",
            "file:///private",
            "http://localhost/x",
            "http://127.0.0.1/x",
            "http://[::1]/x",
            "http://10.0.0.1/x",
            "https://user:password@example.invalid/x",
            "https://example.invalid:8000/x",
            "https://www.bing.com/search?q=x",
            "https://news.google.com/",
            "https://example.invalid/\nattack",
        ):
            with self.subTest(url=url):
                self.assertEqual(
                    self.service._normalize_results([dict(self.result, url=url)], 6), []
                )
        self.assertEqual(
            self.service._normalize_results([dict(self.result, snippet="")], 6), []
        )
        bounded = self.service._normalize_results(
            [dict(self.result, title="a" * 1000, snippet="b" * 5000)], 6
        )[0]
        self.assertEqual(len(bounded["title"]), 300)
        self.assertEqual(len(bounded["snippet"]), 2000)

    def test_search_limits_and_empty_queries_do_not_fetch(self):
        self.adapters(
            [dict(self.result, url=f"https://example.invalid/{i}") for i in range(20)],
            [],
            [],
        )
        self.assertEqual(self.service.search(" "), [])
        self.assertEqual(self.service.search("query", 0), [])
        self.adapter_mocks["fetch_google_live_articles"].assert_not_called()
        self.assertEqual(len(self.service.search("query", 100)), 6)

    def test_provider_parsers_preserve_source_links_and_excerpts(self):
        deadline = time.monotonic() + 10
        google = b"<rss><channel><item><title>Headline</title><link>https://news.google.com/rss/articles/fixture</link><description>&lt;b&gt;Actual excerpt&lt;/b&gt;</description></item></channel></rss>"
        target = "https://example.invalid/article"
        encoded = base64.urlsafe_b64encode(target.encode()).decode().rstrip("=")
        bing = f'<ol id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1{encoded}">Fixture</a></h2><p>Bing excerpt</p></li></ol>'.encode()
        duck = b'<div class="result result--ad"><a class="result__a" href="https://example.invalid/ad">Ad</a></div><div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.invalid%2Farticle">Fixture</a><a class="result__snippet">Duck excerpt</a></div>'
        with patch.object(
            self.service, "_read_response", side_effect=[google, bing, duck]
        ):
            self.assertEqual(
                self.service._fetch_google_live_articles("q", 6, deadline)[0][
                    "snippet"
                ],
                "Actual excerpt",
            )
            self.assertEqual(
                self.service._search_bing("q", 6, deadline)[0]["url"], target
            )
            self.assertEqual(
                self.service._search_duckduckgo("q", 6, deadline),
                [{"title": "Fixture", "url": target, "snippet": "Duck excerpt"}],
            )

    def test_provider_errors_captcha_and_unsafe_xml_are_not_evidence(self):
        from app.core.errors import WebSearchError

        for provider in (
            self.service._fetch_google_live_articles,
            self.service._search_bing,
            self.service._search_duckduckgo,
        ):
            with (
                self.subTest(provider=provider.__name__),
                patch.object(
                    self.service,
                    "_read_response",
                    return_value=b"<html>Captcha challenge</html>",
                ),
            ):
                with self.assertRaises(WebSearchError):
                    provider("q", 6, time.monotonic() + 10)
        payload = '<!DOCTYPE rss [<!ENTITY fixture "expanded">]><rss/>'
        for content in (payload.encode(), payload.encode("utf-16")):
            with patch.object(self.service, "_read_response", return_value=content):
                with self.assertRaises(WebSearchError):
                    self.service._fetch_google_live_articles(
                        "q", 6, time.monotonic() + 10
                    )

    def test_response_budget_status_size_deadline_and_closure(self):
        from app.core.errors import WebSearchError

        response = Mock(status_code=200)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.iter_content.return_value = [b"fixture"]
        with patch.object(self.requests, "request", return_value=response) as request:
            self.assertEqual(
                self.service._read_response(
                    "GET", "https://www.bing.com/search", time.monotonic() + 10
                ),
                b"fixture",
            )
            self.assertFalse(request.call_args.kwargs["allow_redirects"])
            self.assertTrue(request.call_args.kwargs["stream"])
            for status, chunks in (
                (503, []),
                (302, []),
                (200, [b"x" * (self.service.MAX_RESPONSE_BYTES + 1)]),
            ):
                response.status_code = status
                response.iter_content.return_value = chunks
                with self.subTest(status=status), self.assertRaises(WebSearchError):
                    self.service._read_response(
                        "GET", "https://www.bing.com/search", time.monotonic() + 10
                    )
            self.assertEqual(response.__exit__.call_count, 4)
            request.reset_mock()
            with self.assertRaises(WebSearchError):
                self.service._read_response(
                    "GET", "https://www.bing.com/search", time.monotonic() - 1
                )
            request.assert_not_called()
            response.status_code = 200
            response.iter_content.return_value = [b"trickle"]
            with patch("time.monotonic", side_effect=[0, 0, 2]):
                with self.assertRaises(WebSearchError):
                    self.service._read_response("GET", "https://www.bing.com/search", 1)
            self.assertEqual(response.__exit__.call_count, 1)


class TextStreamingTests(unittest.TestCase):
    def setUp(self):
        self.patches = [
            patch.dict("os.environ", {"GEMINI_API_KEY": ""}),
            patch.object(settings, "DEFAULT_LLM_MODEL", "primary", create=True),
            patch.object(
                settings,
                "FALLBACK_LLM_MODELS",
                ["primary", "fallback", "fallback"],
                create=True,
            ),
        ]
        for replacement in self.patches:
            replacement.start()
            self.addCleanup(replacement.stop)
        self.namespace = runpy.run_path(
            str(Path(__file__).resolve().parents[1] / "app/services/llm_service.py")
        )
        self.service = self.namespace["llm_service"]
        self.attempts = []
        self.closed = []

    def provider(self, plans):
        async def generate(**kwargs):
            model = kwargs["model"]
            self.attempts.append(model)
            plan = plans[model]
            if isinstance(plan, BaseException):
                raise plan

            async def chunks():
                try:
                    for value in plan:
                        if isinstance(value, BaseException):
                            raise value
                        yield types.SimpleNamespace(text=value)
                finally:
                    self.closed.append(model)

            return chunks()

        self.service.client = types.SimpleNamespace(
            aio=types.SimpleNamespace(
                models=types.SimpleNamespace(generate_content_stream=generate)
            )
        )

    def test_web_prompt_identifies_evidence_limits_and_rejects_empty_context(self):
        from app.core.errors import TextGenerationError

        captured = []

        async def answer(contents, instruction):
            captured.append((contents, instruction))
            yield "Based on search excerpts: fixture"

        async def collect(results):
            return [
                token
                async for token in self.service.stream_web_search_answer(
                    "Question", results
                )
            ]

        results = [
            {
                "title": "Fixture",
                "url": "https://example.invalid/article",
                "snippet": "Untrusted excerpt",
            }
        ]
        with patch.object(self.service, "_stream_answer", answer):
            self.assertEqual(
                asyncio.run(collect(results)), ["Based on search excerpts: fixture"]
            )
            with self.assertRaises(TextGenerationError):
                asyncio.run(collect([]))
        self.assertEqual(len(captured), 1)
        prompt, instruction = captured[0]
        self.assertIn(results[0]["url"], prompt)
        self.assertIn("Untrusted excerpt", prompt)
        self.assertIn("not retrieved full articles", instruction)
        self.assertIn("never instructions", instruction)
        self.assertIn("incomplete, conflicting", instruction)
        self.assertIn("not fresh web evidence", instruction)

    def test_model_prompt_bounds_history_and_preserves_recent_chronology(self):
        history = [
            {"role": "user", "content": f"Turn {i} " + "x" * 10_000} for i in range(12)
        ]
        formatted = self.service._format_chat_history(history)
        self.assertLess(len(formatted), 33_000)
        self.assertNotIn("Turn 0 ", formatted)
        self.assertIn("Turn 11 ", formatted)
        self.assertLess(formatted.index("Turn 8 "), formatted.index("Turn 11 "))
        self.assertEqual(len(history[-1]["content"]), 10_008)

    def test_mixed_rag_prompt_includes_document_excerpts_and_image_bytes(self):
        from app.core.errors import TextGenerationError
        from app.services.media_service import media_service

        captured = []

        async def answer(contents, instruction):
            captured.append((contents, instruction))
            yield "Comparison"

        attachments = [{"url": "media/uploads/fixture.png", "mime_type": "image/png"}]
        context = [
            {
                "text": "Document evidence",
                "metadata": {"filename": "fixture.txt", "page_number": 1},
            }
        ]

        async def collect():
            return [
                token
                async for token in self.service.stream_rag_answer(
                    "Compare", context, attachments=attachments
                )
            ]

        with (
            patch.object(self.service, "_stream_answer", answer),
            patch.object(
                media_service, "get_media_bytes", return_value=b"fixture-image"
            ),
        ):
            self.assertEqual(asyncio.run(collect()), ["Comparison"])
        contents, instruction = captured[0]
        self.assertEqual(contents[0].inline_data.data, b"fixture-image")
        self.assertIn("Document evidence", contents[1])
        self.assertIn("Compare", contents[1])
        self.assertIn("attached images", instruction)
        with (
            patch.object(self.service, "_stream_answer", answer),
            patch.object(media_service, "get_media_bytes", return_value=None),
        ):
            with self.assertRaises(TextGenerationError):
                asyncio.run(collect())
        self.assertEqual(len(captured), 1)

    def test_fallback_is_allowed_only_before_any_text_and_empty_models_are_retried(
        self,
    ):
        for first in (RuntimeError("fixture unavailable"), [], [None, ""]):
            self.attempts.clear()
            self.provider({"primary": first, "fallback": ["Fallback ", "answer"]})

            async def collect():
                return [
                    token
                    async for token in self.service._stream_answer("fixture", "fixture")
                ]

            self.assertEqual(asyncio.run(collect()), ["Fallback ", "answer"])
            self.assertEqual(self.attempts, ["primary", "fallback"])

    def test_all_text_routes_preserve_partial_output_without_starting_a_second_answer(
        self,
    ):
        from app.core.errors import TextGenerationError

        for mode in ("conversation", "rag", "web", "vision"):
            with self.subTest(mode=mode):
                self.attempts.clear()
                self.closed.clear()
                self.provider(
                    {
                        "primary": [
                            "Partial ",
                            RuntimeError("private fixture provider detail"),
                        ],
                        "fallback": ["Must not append"],
                    }
                )
                if mode == "conversation":
                    stream = self.service.stream_conversational_answer("hello")
                elif mode == "rag":
                    stream = self.service.stream_rag_answer(
                        "review", [{"text": "fixture", "metadata": {}}]
                    )
                elif mode == "web":
                    stream = self.service.stream_web_search_answer(
                        "weather",
                        [
                            {
                                "title": "Weather",
                                "url": "https://example.invalid/weather",
                                "snippet": "Forecast excerpt",
                            }
                        ],
                    )
                else:
                    stream = self.service.stream_multimodal_answer("describe", [])
                observed = []

                async def collect():
                    async for token in stream:
                        observed.append(token)

                with self.assertRaises(TextGenerationError) as caught:
                    asyncio.run(collect())
                self.assertEqual(observed, ["Partial "])
                self.assertNotIn("private fixture", str(caught.exception))
                self.assertEqual(self.attempts, ["primary"])
                self.assertEqual(self.closed, ["primary"])

    def test_unconfigured_and_exhausted_providers_fail_instead_of_fabricating_answers(
        self,
    ):
        from app.core.errors import TextGenerationError

        for configured in (False, True):
            if configured:
                self.provider(
                    {"primary": [], "fallback": RuntimeError("fixture unavailable")}
                )
            else:
                self.service.client = None

            async def collect():
                return [
                    token
                    async for token in self.service.stream_conversational_answer(
                        "hello"
                    )
                ]

            with self.assertRaises(TextGenerationError):
                asyncio.run(collect())

    def test_closing_after_output_closes_provider_without_starting_fallback(self):
        self.provider({"primary": ["First", "Second"], "fallback": ["Wrong"]})

        async def stop():
            stream = self.service.stream_conversational_answer("hello")
            self.assertEqual(await anext(stream), "First")
            await stream.aclose()

        asyncio.run(stop())
        self.assertEqual(self.closed, ["primary"])
        self.assertEqual(self.attempts, ["primary"])

    def test_task_cancellation_while_waiting_for_provider_does_not_retry(self):
        async def verify():
            waiting = asyncio.Event()

            async def chunks():
                try:
                    yield types.SimpleNamespace(text="Partial")
                    waiting.set()
                    await asyncio.Event().wait()
                finally:
                    self.closed.append("primary")

            async def generate(**kwargs):
                self.attempts.append(kwargs["model"])
                return chunks()

            self.service.client = types.SimpleNamespace(
                aio=types.SimpleNamespace(
                    models=types.SimpleNamespace(generate_content_stream=generate)
                )
            )
            stream = self.service.stream_conversational_answer("hello")
            self.assertEqual(await anext(stream), "Partial")
            task = asyncio.create_task(anext(stream))
            await waiting.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            await stream.aclose()

        asyncio.run(verify())
        self.assertEqual(self.closed, ["primary"])
        self.assertEqual(self.attempts, ["primary"])


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

        for replacement in (
            patch.object(database, "is_turso_configured", return_value=True),
            patch.object(
                database, "get_turso_url", return_value="wss://fixture.invalid"
            ),
            patch.object(libsql_client, "create_client_sync", side_effect=client),
        ):
            replacement.start()
            self.addCleanup(replacement.stop)

    def test_cloud_initializer_is_repeatable(self):
        database.init_db()
        self.assertEqual(self.request("GET", "/user/me", self.token).status_code, 200)


class EmailDeliveryTests(unittest.TestCase):
    def setUp(self):
        module_path = (
            Path(__file__).resolve().parents[1] / "app/services/email_service.py"
        )
        self.namespace = runpy.run_path(str(module_path))
        self.mail = self.namespace["EmailService"]()

    def test_unconfigured_smtp_fails_without_logging_email_content(self):
        with (
            patch.object(settings, "SMTP_HOST", "", create=True),
            patch.object(logger, "warning") as log,
        ):
            self.assertFalse(
                self.mail._send_smtp_sync(
                    "fixture@example.invalid",
                    "secret subject",
                    "secret body",
                    "secret html",
                )
            )
        self.assertNotIn("secret", str(log.call_args))

    def test_provider_error_body_is_not_logged(self):
        import urllib.error

        with (
            patch.multiple(
                settings,
                BREVO_API_KEY="fixture",
                BREVO_FROM_EMAIL="fixture@example.invalid",
                BREVO_FROM_NAME="Fixture",
                create=True,
            ),
            patch(
                "urllib.request.urlopen",
                side_effect=urllib.error.HTTPError(
                    "https://fixture.invalid",
                    400,
                    "fixture",
                    Message(),
                    io.BytesIO(b"secret provider response"),
                ),
            ),
            patch.object(logger, "error") as log,
        ):
            self.assertFalse(
                self.mail._send_brevo_http(
                    "fixture@example.invalid", "secret", "secret", "secret"
                )
            )
        self.assertNotIn("secret", str(log.call_args))

    def test_turso_transport_supports_transactions(self):
        for source, expected in (
            ("libsql://fixture.invalid", "libsql://fixture.invalid"),
            ("https://fixture.invalid", "wss://fixture.invalid"),
            ("http://localhost:8080", "ws://localhost:8080"),
        ):
            with patch.object(settings, "TURSO_DATABASE_URL", source):
                self.assertEqual(database.get_turso_url(), expected)


class GoogleVerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from google.auth.crypt import RSASigner

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        cls.signer = RSASigner.from_string(private, key_id="fixture-key")
        cls.public = (
            key.public_key()
            .public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            .decode()
        )

    def token(self, **updates):
        from google.auth import jwt

        claims = {
            "iss": "https://accounts.google.com",
            "aud": "fixture-client",
            "sub": "fixture-subject",
            "email": "fixture@gmail.com",
            "email_verified": True,
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        }
        claims.update(updates)
        return jwt.encode(self.signer, claims).decode()

    def test_real_google_library_validates_signed_claims(self):
        from fastapi import HTTPException

        response = types.SimpleNamespace(
            status=200, data=json.dumps({"fixture-key": self.public}).encode()
        )
        with patch.object(
            google_auth, "Request", return_value=lambda *args, **kwargs: response
        ):
            self.assertEqual(
                google_auth.verify_google_credential(self.token())["sub"],
                "fixture-subject",
            )
            for updates in (
                {"aud": "wrong"},
                {"iss": "attacker.invalid"},
                {"exp": 1},
                {"email_verified": False},
                {"sub": ""},
                {"email": ""},
            ):
                with self.subTest(updates=updates), self.assertRaises(HTTPException):
                    google_auth.verify_google_credential(self.token(**updates))
            with self.assertRaises(HTTPException):
                google_auth.verify_google_credential(self.token()[:-10] + "forged")
            self.assertEqual(
                google_auth.verify_google_credential(
                    self.token(nonce="challenge"), "challenge"
                )["nonce"],
                "challenge",
            )
            with self.assertRaises(HTTPException):
                google_auth.verify_google_credential(
                    self.token(nonce="different"), "challenge"
                )


if __name__ == "__main__":
    try:
        unittest.main()
    finally:
        outbound.stop()
        fixture.cleanup()
