from typing import Dict, List, Optional
from datetime import datetime
from app.schemas.chat import ChatMode, SessionState
from app.schemas.document import DocumentMetadata

class SessionStoreRepository:
    """In-memory thread-safe session & document metadata store."""
    def __init__(self):
        self._sessions: Dict[str, SessionState] = {}
        self._documents: Dict[str, DocumentMetadata] = {}

    def get_or_create_session(self, session_id: str, default_mode: ChatMode = ChatMode.DOCUMENT_RAG) -> SessionState:
        if session_id not in self._sessions:
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

    def attach_document_to_session(self, session_id: str, document_id: str):
        session = self.get_or_create_session(session_id)
        if document_id not in session.document_ids:
            session.document_ids.append(document_id)

    def save_document_metadata(self, metadata: DocumentMetadata):
        self._documents[metadata.document_id] = metadata

    def get_document_metadata(self, document_id: str) -> Optional[DocumentMetadata]:
        return self._documents.get(document_id)

    def list_all_documents(self) -> List[DocumentMetadata]:
        return list(self._documents.values())

    def remove_document(self, document_id: str):
        if document_id in self._documents:
            del self._documents[document_id]
        for session in self._sessions.values():
            if document_id in session.document_ids:
                session.document_ids.remove(document_id)

session_store_repo = SessionStoreRepository()
