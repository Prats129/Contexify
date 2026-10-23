from threading import RLock
from typing import Any, Dict, List, Optional

from app.db.database import get_db_connection
from app.schemas.chat import ChatMode, SessionState
from app.schemas.document import DocumentMetadata
from app.services.chat_history_service import chat_history_service
from app.services.session_lifecycle import active_session


class SessionStoreRepository:
    """Persistent session & document metadata store backed by SQLite."""

    def __init__(self):
        self._cache_lock = RLock()
        self._sessions: Dict[str, SessionState] = {}
        self._documents: Dict[str, DocumentMetadata] = {}

    def get_or_create_session(
        self,
        session_id: str,
        default_mode: ChatMode = ChatMode.AUTO,
        user_id: Optional[str] = None,
    ) -> SessionState:
        with get_db_connection() as conn:
            row = active_session(conn, session_id)
        docs = chat_history_service.list_session_documents(session_id)
        with self._cache_lock:
            session = self._sessions.setdefault(
                session_id,
                SessionState(
                    session_id=session_id,
                    mode=row["mode"],
                    document_ids=[doc.document_id for doc in docs],
                    created_at=row["created_at"],
                    history_version=row["history_version"],
                ),
            )
            # SQL remains authoritative across API workers.
            session.mode = ChatMode(row["mode"])
            session.document_ids = [doc.document_id for doc in docs]
            for doc in docs:
                self._documents[doc.document_id] = doc
            self.invalidate_cached_history(session_id, row["history_version"])
            return session

    def invalidate_cached_history(self, session_id: str, history_version: int) -> None:
        """Discard older history without changing documents or session settings."""
        with self._cache_lock:
            session = self._sessions.get(session_id)
            if session is not None and session.history_version < history_version:
                session.messages.clear()
                session.history_version = history_version

    def set_session_mode(self, session_id: str, mode: ChatMode):
        session = self.get_or_create_session(session_id)
        with self._cache_lock:
            session.mode = mode
        chat_history_service.update_session_mode(session_id, mode)

    def attach_document_to_session(self, session_id: str, document_id: str):
        session = self.get_or_create_session(session_id)
        with self._cache_lock:
            if document_id not in session.document_ids:
                session.document_ids.append(document_id)

    def save_document_metadata(
        self,
        metadata: DocumentMetadata,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ):
        if session_id:
            chat_history_service.save_document(
                document_id=metadata.document_id,
                user_id=user_id,
                session_id=session_id,
                filename=metadata.filename,
                file_type=metadata.file_type,
                file_size_bytes=metadata.file_size_bytes,
                total_chunks=metadata.total_chunks,
                storage_url=getattr(metadata, "storage_url", "") or "",
            )
        with self._cache_lock:
            self._documents[metadata.document_id] = metadata

    def get_document_metadata(self, document_id: str) -> Optional[DocumentMetadata]:
        with get_db_connection() as conn:
            row = conn.execute(
                "SELECT * FROM documents WHERE id=?", (document_id,)
            ).fetchone()
            if not row:
                with self._cache_lock:
                    self._documents.pop(document_id, None)
                return None
            if row["session_id"]:
                active_session(conn, row["session_id"])
            return DocumentMetadata(
                document_id=row["id"],
                filename=row["filename"],
                file_type=row["file_type"],
                file_size_bytes=row["file_size_bytes"],
                total_chunks=row["total_chunks"],
                storage_url=row["storage_url"] or None,
                uploaded_at=row["created_at"],
            )

    def list_all_documents(self) -> List[DocumentMetadata]:
        with self._cache_lock:
            return list(self._documents.values())

    def get_history_messages(self, session_id: str) -> List[Dict[str, Any]]:
        """Use SQL for signed-in history and versioned memory for guest history."""
        with get_db_connection() as conn:
            row = active_session(conn, session_id)
        self.invalidate_cached_history(session_id, row["history_version"])
        db_messages = chat_history_service.get_session_messages(session_id)
        if not row["user_id"].startswith("guest_") or db_messages:
            return [
                {
                    "id": m.id,
                    "role": m.role,
                    "content": m.content,
                    "attachments": [
                        a.model_dump() if hasattr(a, "model_dump") else a
                        for a in (m.attachments or [])
                    ],
                    "reply_to": m.reply_to.model_dump()
                    if m.reply_to and hasattr(m.reply_to, "model_dump")
                    else (m.reply_to if isinstance(m.reply_to, dict) else None),
                }
                for m in db_messages
            ]
        session = self.get_or_create_session(session_id)
        with self._cache_lock:
            messages = list(session.messages)
        return [
            {
                "id": m.get("id", ""),
                "role": m.get("role", "user"),
                "content": m.get("content", ""),
                "attachments": m.get("attachments", []),
                "reply_to": m.get("reply_to"),
            }
            for m in messages
        ]

    def record_message(
        self,
        session_id: str,
        role: str,
        content: str,
        attachments: Optional[List[Any]] = None,
        reply_to: Optional[Any] = None,
        message_id: Optional[str] = None,
    ):
        """Record an in-memory message for active/guest sessions."""
        session = self.get_or_create_session(session_id)
        msg_dict: Dict[str, Any] = {
            "id": message_id or "",
            "role": role,
            "content": content,
        }
        if attachments:
            msg_dict["attachments"] = [
                a.model_dump() if hasattr(a, "model_dump") else a for a in attachments
            ]
        if reply_to:
            msg_dict["reply_to"] = (
                reply_to.model_dump()
                if hasattr(reply_to, "model_dump")
                else (reply_to if isinstance(reply_to, dict) else dict(reply_to))
            )
        with self._cache_lock:
            session.messages.append(msg_dict)

    def remove_document(self, document_id: str):
        from app.services.storage_service import storage_service

        # Check storage URL to purge from Cloudflare R2
        storage_url = chat_history_service.get_document_storage_url(document_id)
        if storage_url:
            storage_service.delete_file(storage_url)

        with self._cache_lock:
            self._documents.pop(document_id, None)
            for session in self._sessions.values():
                if document_id in session.document_ids:
                    session.document_ids.remove(document_id)
        chat_history_service.delete_document(document_id)


session_store_repo = SessionStoreRepository()
