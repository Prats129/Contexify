import json
import uuid
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from app.core.config import settings
from app.db.database import get_db_connection
from app.schemas.chat import ChatMode, Citation, MediaAttachment
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
        mode: ChatMode = ChatMode.WEB_SEARCH,
        is_temporary: bool = False
    ) -> ChatSessionResponse:
        session_id = session_id or str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        expires_at = None
        if is_temporary:
            expires_at = (datetime.utcnow() + timedelta(days=settings.TEMPORARY_CHAT_RETENTION_DAYS)).isoformat()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO chat_sessions (id, user_id, title, mode, is_temporary, expires_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, user_id, title, mode.value if hasattr(mode, 'value') else str(mode), 1 if is_temporary else 0, expires_at, now, now)
            )
            
        logger.info(f"Created/registered chat session '{session_id}' for user '{user_id}' [Temporary={is_temporary}]")
        return ChatSessionResponse(
            id=session_id,
            user_id=user_id,
            title=title,
            mode=ChatMode(mode) if isinstance(mode, str) else mode,
            is_temporary=is_temporary,
            expires_at=expires_at,
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
                    s.id, s.user_id, s.title, s.mode, s.is_temporary, s.expires_at, s.created_at, s.updated_at,
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
                is_temporary=bool(row["is_temporary"]),
                expires_at=row["expires_at"],
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
                    s.id, s.user_id, s.title, s.mode, s.is_temporary, s.expires_at, s.created_at, s.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
                    (SELECT COUNT(*) FROM documents d WHERE d.session_id = s.id) AS document_count
                FROM chat_sessions s
                WHERE s.user_id = ? AND (s.is_temporary IS NULL OR s.is_temporary = 0)
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
                    is_temporary=bool(row["is_temporary"]),
                    expires_at=row["expires_at"],
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
        citations: Optional[List[Dict[str, Any]]] = None,
        attachments: Optional[List[Any]] = None
    ) -> MessageResponse:
        message_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        citations_json = json.dumps(citations) if citations else None
        
        # Serialize attachments to JSON
        attachments_json = "[]"
        attachments_obj = None
        if attachments:
            try:
                dumped = []
                for a in attachments:
                    if hasattr(a, "model_dump"):
                        dumped.append(a.model_dump())
                    elif isinstance(a, dict):
                        dumped.append(a)
                attachments_json = json.dumps(dumped)
                attachments_obj = [MediaAttachment(**a) if isinstance(a, dict) else a for a in dumped]
            except Exception as e:
                logger.error(f"Error serializing attachments for session {session_id}: {e}")
                attachments_json = "[]"

        # Only persist to SQLite if the session is registered in the database (logged-in user)
        if self.get_session(session_id) is not None:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT INTO messages (id, session_id, role, content, citations_json, attachments_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (message_id, session_id, role, content, citations_json, attachments_json, now)
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
            attachments=attachments_obj,
            created_at=now
        )

    def get_session_messages(self, session_id: str) -> List[MessageResponse]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, session_id, role, content, citations_json, attachments_json, created_at
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

                attachments = None
                # Check if attachments_json column exists and has content
                row_keys = row.keys() if hasattr(row, "keys") else []
                if "attachments_json" in row_keys and row["attachments_json"]:
                    try:
                        raw_att = json.loads(row["attachments_json"])
                        if raw_att:
                            attachments = [MediaAttachment(**a) for a in raw_att]
                    except Exception as e:
                        logger.error(f"Error parsing attachments for message {row['id']}: {e}")
                
                messages.append(MessageResponse(
                    id=row["id"],
                    session_id=row["session_id"],
                    role=row["role"],
                    content=row["content"],
                    citations=citations,
                    attachments=attachments,
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
        total_chunks: int,
        storage_url: str = ""
    ) -> DocumentMetadata:
        now = datetime.utcnow().isoformat()
        # Only persist to SQLite if the session is registered in the database
        if self.get_session(session_id) is not None:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO documents (id, user_id, session_id, filename, file_type, file_size_bytes, total_chunks, storage_url, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (document_id, user_id, session_id, filename, file_type, file_size_bytes, total_chunks, storage_url, now)
                )
            
        return DocumentMetadata(
            document_id=document_id,
            filename=filename,
            file_type=file_type,
            file_size_bytes=file_size_bytes,
            total_chunks=total_chunks,
            storage_url=storage_url if storage_url else None,
            uploaded_at=now
        )

    def list_session_documents(self, session_id: str) -> List[DocumentMetadata]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, filename, file_type, file_size_bytes, total_chunks, storage_url, created_at
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
                    storage_url=row["storage_url"] if "storage_url" in row.keys() and row["storage_url"] else None,
                    uploaded_at=row["created_at"]
                )
                for row in rows
            ]

    def get_document_storage_url(self, document_id: str) -> Optional[str]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT storage_url FROM documents WHERE id = ?", (document_id,))
            row = cursor.fetchone()
            if row and "storage_url" in row.keys() and row["storage_url"]:
                return row["storage_url"]
        return None

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

    def purge_expired_temporary_sessions(self) -> int:
        """
        Purge all temporary chat sessions that have passed their expiration timestamp.
        Deletes vector store chunks, attached files, and cascades DB deletion.
        """
        now = datetime.utcnow().isoformat()
        purged_count = 0
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT id FROM chat_sessions
                    WHERE is_temporary = 1 AND expires_at IS NOT NULL AND expires_at < ?
                    """,
                    (now,)
                )
                expired_rows = cursor.fetchall()
                expired_session_ids = [row["id"] for row in expired_rows]

            if not expired_session_ids:
                return 0

            from app.repositories.vector_store import vector_store_repo
            for sess_id in expired_session_ids:
                docs = self.list_session_documents(sess_id)
                for doc in docs:
                    try:
                        vector_store_repo.delete_document(doc.document_id)
                    except Exception as ve:
                        logger.warning(f"Error purging vector store for doc '{doc.document_id}': {ve}")

                self.delete_session(sess_id)
                purged_count += 1

            logger.info(f"Successfully purged {purged_count} expired temporary chat session(s).")
        except Exception as e:
            logger.error(f"Error purging expired temporary sessions: {e}")

        return purged_count

chat_history_service = ChatHistoryService()
