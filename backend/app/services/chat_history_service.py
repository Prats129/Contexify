import json
import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
from app.db.database import get_db_connection
from app.schemas.chat import ChatMode, Citation
from app.schemas.document import DocumentMetadata
from app.schemas.session import ChatSessionResponse, MessageResponse, SessionHistoryResponse
from app.core.logging import logger

class ChatHistoryService:
    """Chat session, message history, and document persistence service."""

    def create_session(
        self,
        user_id: str,
        session_id: Optional[str] = None,
        title: str = "New Conversation",
        mode: ChatMode = ChatMode.DOCUMENT_RAG
    ) -> ChatSessionResponse:
        session_id = session_id or str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO chat_sessions (id, user_id, title, mode, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (session_id, user_id, title, mode.value if hasattr(mode, 'value') else str(mode), now, now)
            )
            
        logger.info(f"Created/registered chat session '{session_id}' for user '{user_id}'")
        return ChatSessionResponse(
            id=session_id,
            user_id=user_id,
            title=title,
            mode=ChatMode(mode) if isinstance(mode, str) else mode,
            created_at=now,
            updated_at=now,
            message_count=0,
            document_count=0
        )

    def get_session(self, session_id: str) -> Optional[ChatSessionResponse]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT 
                    s.id, s.user_id, s.title, s.mode, s.created_at, s.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
                    (SELECT COUNT(*) FROM documents d WHERE d.session_id = s.id) AS document_count
                FROM chat_sessions s
                WHERE s.id = ?
                """,
                (session_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return ChatSessionResponse(
                id=row["id"],
                user_id=row["user_id"],
                title=row["title"],
                mode=ChatMode(row["mode"]),
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                message_count=row["message_count"],
                document_count=row["document_count"]
            )

    def list_user_sessions(self, user_id: str) -> List[ChatSessionResponse]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT 
                    s.id, s.user_id, s.title, s.mode, s.created_at, s.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
                    (SELECT COUNT(*) FROM documents d WHERE d.session_id = s.id) AS document_count
                FROM chat_sessions s
                WHERE s.user_id = ?
                ORDER BY s.updated_at DESC
                """,
                (user_id,)
            )
            rows = cursor.fetchall()
            return [
                ChatSessionResponse(
                    id=row["id"],
                    user_id=row["user_id"],
                    title=row["title"],
                    mode=ChatMode(row["mode"]),
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                    message_count=row["message_count"],
                    document_count=row["document_count"]
                )
                for row in rows
            ]

    def update_session_title(self, session_id: str, title: str) -> bool:
        now = datetime.utcnow().isoformat()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
                (title, now, session_id)
            )
            return cursor.rowcount > 0

    def update_session_mode(self, session_id: str, mode: ChatMode) -> bool:
        now = datetime.utcnow().isoformat()
        mode_val = mode.value if hasattr(mode, 'value') else str(mode)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE chat_sessions SET mode = ?, updated_at = ? WHERE id = ?",
                (mode_val, now, session_id)
            )
            return cursor.rowcount > 0

    def touch_session(self, session_id: str):
        now = datetime.utcnow().isoformat()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
                (now, session_id)
            )

    def delete_session(self, session_id: str) -> bool:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
            return cursor.rowcount > 0

    def clear_session_messages(self, session_id: str) -> bool:
        now = datetime.utcnow().isoformat()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            cursor.execute(
                "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
                (now, session_id)
            )
            return True


    def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        citations: Optional[List[Dict[str, Any]]] = None
    ) -> MessageResponse:
        message_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        citations_json = json.dumps(citations) if citations else None
        
        # Only persist to SQLite if the session is registered in the database (logged-in user)
        if self.get_session(session_id) is not None:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT INTO messages (id, session_id, role, content, citations_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (message_id, session_id, role, content, citations_json, now)
                )
                cursor.execute(
                    "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
                    (now, session_id)
                )

        citations_obj = None
        if citations:
            citations_obj = [Citation(**c) if isinstance(c, dict) else c for c in citations]

        return MessageResponse(
            id=message_id,
            session_id=session_id,
            role=role,
            content=content,
            citations=citations_obj,
            created_at=now
        )

    def get_session_messages(self, session_id: str) -> List[MessageResponse]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, session_id, role, content, citations_json, created_at
                FROM messages
                WHERE session_id = ?
                ORDER BY created_at ASC
                """,
                (session_id,)
            )
            rows = cursor.fetchall()
            
            messages = []
            for row in rows:
                citations = None
                if row["citations_json"]:
                    try:
                        raw_c = json.loads(row["citations_json"])
                        citations = [Citation(**c) for c in raw_c]
                    except Exception as e:
                        logger.error(f"Error parsing citations for message {row['id']}: {e}")
                
                messages.append(MessageResponse(
                    id=row["id"],
                    session_id=row["session_id"],
                    role=row["role"],
                    content=row["content"],
                    citations=citations,
                    created_at=row["created_at"]
                ))
            return messages

    def save_document(
        self,
        document_id: str,
        user_id: Optional[str],
        session_id: str,
        filename: str,
        file_type: str,
        file_size_bytes: int,
        total_chunks: int
    ) -> DocumentMetadata:
        now = datetime.utcnow().isoformat()
        # Only persist to SQLite if the session is registered in the database
        if self.get_session(session_id) is not None:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO documents (id, user_id, session_id, filename, file_type, file_size_bytes, total_chunks, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (document_id, user_id, session_id, filename, file_type, file_size_bytes, total_chunks, now)
                )
            
        return DocumentMetadata(
            document_id=document_id,
            filename=filename,
            file_type=file_type,
            file_size_bytes=file_size_bytes,
            total_chunks=total_chunks,
            uploaded_at=now
        )

    def list_session_documents(self, session_id: str) -> List[DocumentMetadata]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, filename, file_type, file_size_bytes, total_chunks, created_at
                FROM documents
                WHERE session_id = ?
                ORDER BY created_at DESC
                """,
                (session_id,)
            )
            rows = cursor.fetchall()
            return [
                DocumentMetadata(
                    document_id=row["id"],
                    filename=row["filename"],
                    file_type=row["file_type"],
                    file_size_bytes=row["file_size_bytes"],
                    total_chunks=row["total_chunks"],
                    uploaded_at=row["created_at"]
                )
                for row in rows
            ]

    def delete_document(self, document_id: str) -> bool:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM documents WHERE id = ?", (document_id,))
            return cursor.rowcount > 0

    def get_session_history(self, session_id: str) -> Optional[SessionHistoryResponse]:
        session = self.get_session(session_id)
        if not session:
            return None
        messages = self.get_session_messages(session_id)
        documents = self.list_session_documents(session_id)
        return SessionHistoryResponse(
            session=session,
            messages=messages,
            documents=documents
        )

chat_history_service = ChatHistoryService()
