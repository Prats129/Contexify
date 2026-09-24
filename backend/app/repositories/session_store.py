from typing import Dict, List, Optional, Any
from datetime import datetime
from app.schemas.chat import ChatMode, SessionState
from app.schemas.document import DocumentMetadata
from app.services.chat_history_service import chat_history_service

class SessionStoreRepository:
    """Persistent session & document metadata store backed by SQLite."""
    def __init__(self):
        self._sessions: Dict[str, SessionState] = {}
        self._documents: Dict[str, DocumentMetadata] = {}

    def get_or_create_session(self, session_id: str, default_mode: ChatMode = ChatMode.AUTO, user_id: Optional[str] = None) -> SessionState:
        if session_id not in self._sessions:
            # Check if exists in DB (logged-in user session)
            db_session = chat_history_service.get_session(session_id)
            if db_session:
                docs = chat_history_service.list_session_documents(session_id)
                doc_ids = [d.document_id for d in docs]
                for d in docs:
                    self._documents[d.document_id] = d
                self._sessions[session_id] = SessionState(
                    session_id=session_id,
                    mode=db_session.mode,
                    document_ids=doc_ids,
                    created_at=db_session.created_at
                )
            else:
                # Ephemeral in-memory session (guest mode or temporary active stream)
                self._sessions[session_id] = SessionState(
                    session_id=session_id,
                    mode=default_mode,
                    document_ids=[],
                    created_at=datetime.utcnow().isoformat()
                )
        return self._sessions[session_id]

    def set_session_mode(self, session_id: str, mode: ChatMode):
        session = self.get_or_create_session(session_id)
        session.mode = mode
        chat_history_service.update_session_mode(session_id, mode)

    def attach_document_to_session(self, session_id: str, document_id: str):
        session = self.get_or_create_session(session_id)
        if document_id not in session.document_ids:
            session.document_ids.append(document_id)

    def save_document_metadata(self, metadata: DocumentMetadata, user_id: Optional[str] = None, session_id: Optional[str] = None):
        self._documents[metadata.document_id] = metadata
        if session_id:
            chat_history_service.save_document(
                document_id=metadata.document_id,
                user_id=user_id,
                session_id=session_id,
                filename=metadata.filename,
                file_type=metadata.file_type,
                file_size_bytes=metadata.file_size_bytes,
                total_chunks=metadata.total_chunks,
                storage_url=getattr(metadata, "storage_url", "") or ""
            )

    def get_document_metadata(self, document_id: str) -> Optional[DocumentMetadata]:
        if document_id in self._documents:
            return self._documents[document_id]
        return None

    def list_all_documents(self) -> List[DocumentMetadata]:
        return list(self._documents.values())

    def get_history_messages(self, session_id: str) -> List[Dict[str, Any]]:
        """Retrieve conversation history for a session from SQLite or in-memory state including attachments."""
        db_messages = chat_history_service.get_session_messages(session_id)
        if db_messages:
            return [
                {
                    "role": m.role,
                    "content": m.content,
                    "attachments": [a.model_dump() if hasattr(a, "model_dump") else a for a in (m.attachments or [])]
                }
                for m in db_messages
            ]
        session = self.get_or_create_session(session_id)
        return [
            {
                "role": m.get("role", "user"),
                "content": m.get("content", ""),
                "attachments": m.get("attachments", [])
            }
            for m in session.messages
        ]

    def record_message(self, session_id: str, role: str, content: str, attachments: Optional[List[Any]] = None):
        """Record an in-memory message for active/guest sessions."""
        session = self.get_or_create_session(session_id)
        msg_dict: Dict[str, Any] = {"role": role, "content": content}
        if attachments:
            msg_dict["attachments"] = [a.model_dump() if hasattr(a, "model_dump") else a for a in attachments]
        session.messages.append(msg_dict)

    def remove_document(self, document_id: str):
        from app.services.storage_service import storage_service
        # Check storage URL to purge from Cloudflare R2
        storage_url = chat_history_service.get_document_storage_url(document_id)
        if storage_url:
            storage_service.delete_file(storage_url)

        if document_id in self._documents:
            del self._documents[document_id]
        for session in self._sessions.values():
            if document_id in session.document_ids:
                session.document_ids.remove(document_id)
        chat_history_service.delete_document(document_id)

session_store_repo = SessionStoreRepository()
