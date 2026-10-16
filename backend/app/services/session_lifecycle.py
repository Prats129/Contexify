"""Durable chat deletion, including resources outside the SQL transaction.

Deletion markers deliberately outlive chat rows: a delayed request must never
recreate a deleted chat. Resource intents are recorded before external writes.
"""

import inspect
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, Generator, ParamSpec, Sequence, TypeVar

from fastapi import HTTPException

from app.core.logging import logger
from app.db.database import get_db_connection
from app.services.upload_lifecycle import current_upload_attempt, purge_failed_uploads

P = ParamSpec("P")
T = TypeVar("T")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def active_session(conn: Any, session_id: str) -> Any:
    row = conn.execute(
        "SELECT s.* FROM chat_sessions s WHERE s.id=? "
        "AND NOT EXISTS (SELECT 1 FROM session_deletions d WHERE d.session_id=s.id)",
        (session_id,),
    ).fetchone()
    if not row or (row["expires_at"] and row["expires_at"] <= utc_now()):
        raise HTTPException(404, "Session not found.")
    return row


def register_resource(session_id: str | None, kind: str, key: str) -> None:
    attempt_id = current_upload_attempt.get()
    if not session_id and not attempt_id:
        return
    with get_db_connection(write=True) as conn:
        if session_id:
            active_session(conn, session_id)
            conn.execute(
                "INSERT INTO session_resources (session_id,kind,resource_key) VALUES (?,?,?) "
                "ON CONFLICT DO NOTHING",
                (session_id, kind, key),
            )
        if attempt_id:
            row = conn.execute(
                "SELECT state FROM upload_attempts WHERE id=?", (attempt_id,)
            ).fetchone()
            if not row or row["state"] != "pending":
                raise HTTPException(
                    409, "Upload expired before it completed. Please retry."
                )
            conn.execute(
                "INSERT INTO upload_resources VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
                (attempt_id, session_id, kind, key),
            )


@contextmanager
def resource_operation(session_id: str | None) -> Generator[None, None, None]:
    """Keep cleanup away from an external write, including worker-thread writes.

    Heartbeats support multiple API processes. A crashed worker's lease expires;
    its pre-recorded resources remain available for the next cleanup attempt.
    """
    if not session_id:
        yield
        return
    operation_id = uuid.uuid4().hex
    with get_db_connection(write=True) as conn:
        active_session(conn, session_id)
        conn.execute(
            "INSERT INTO session_operations VALUES (?,?,?)",
            (operation_id, session_id, time.time() + 300),
        )
    stopped = threading.Event()

    def heartbeat() -> None:
        while not stopped.wait(30):
            try:
                with get_db_connection(write=True) as conn:
                    conn.execute(
                        "UPDATE session_operations SET expires_at=? WHERE id=?",
                        (time.time() + 300, operation_id),
                    )
            except Exception:
                logger.warning(
                    "Could not renew resource operation lease", exc_info=True
                )

    worker = threading.Thread(target=heartbeat, daemon=True)
    worker.start()
    try:
        yield
    finally:
        stopped.set()
        worker.join()
        try:
            with get_db_connection(write=True) as conn:
                conn.execute(
                    "DELETE FROM session_operations WHERE id=?", (operation_id,)
                )
        except Exception:
            logger.warning(
                "Resource operation lease will expire automatically", exc_info=True
            )


def protect_resource_write(function: Callable[P, T]) -> Callable[P, T]:
    signature = inspect.signature(function)

    @wraps(function)
    def guarded(*args: P.args, **kwargs: P.kwargs) -> T:
        arguments = signature.bind(*args, **kwargs).arguments
        with resource_operation(arguments.get("session_id")):
            return function(*args, **kwargs)

    return guarded


def evict_session(
    session_id: str,
    document_ids: Sequence[str] = (),
    *,
    remove_references: bool = False,
) -> None:
    from app.repositories.session_store import session_store_repo

    session_store_repo._sessions.pop(session_id, None)
    for document_id in document_ids:
        session_store_repo._documents.pop(document_id, None)
    # Other active chats may have referenced temporary documents.
    if remove_references:
        for session in list(session_store_repo._sessions.values()):
            session.document_ids[:] = [
                key for key in session.document_ids if key not in document_ids
            ]


def _is_temporary_session(session: Any) -> bool:
    return bool(session["is_temporary"]) or session["user_id"].startswith("guest_")


def _preserve_library_assets(conn: Any, session_id: str, user_id: str) -> None:
    """Keep normal-chat assets accessible independently of cleanup progress."""
    for table in ("documents", "media_assets"):
        conn.execute(
            f"UPDATE {table} SET user_id=COALESCE(NULLIF(user_id,''),?),session_id=NULL WHERE session_id=?",
            (user_id, session_id),
        )


def request_deletion(session_id: str) -> bool:
    with get_db_connection(write=True) as conn:
        row = conn.execute(
            "SELECT user_id,is_temporary FROM chat_sessions WHERE id=?", (session_id,)
        ).fetchone()
        if not row:
            return bool(
                conn.execute(
                    "SELECT 1 FROM session_deletions WHERE session_id=?", (session_id,)
                ).fetchone()
            )
        conn.execute(
            "INSERT INTO session_deletions (session_id,user_id,requested_at) VALUES (?,?,?) "
            "ON CONFLICT DO NOTHING",
            (session_id, row["user_id"], utc_now()),
        )
        if not _is_temporary_session(row):
            _preserve_library_assets(conn, session_id, row["user_id"])
    evict_session(session_id)
    cleanup_session(session_id)
    return True


def cleanup_session(session_id: str) -> bool:
    from app.repositories.vector_store import vector_store_repo
    from app.services.storage_service import storage_service

    try:
        with get_db_connection(write=True) as conn:
            job = conn.execute(
                "SELECT * FROM session_deletions WHERE session_id=? AND completed_at IS NULL",
                (session_id,),
            ).fetchone()
            if not job:
                return False
            session = conn.execute(
                "SELECT * FROM chat_sessions WHERE id=?", (session_id,)
            ).fetchone()
            if not session:
                return False
            temporary = _is_temporary_session(session)
            if not temporary:
                # Also repair normal-chat deletions queued by older code.
                _preserve_library_assets(conn, session_id, session["user_id"])
            conn.execute(
                "UPDATE session_deletions SET last_attempt_at=? WHERE session_id=?",
                (time.time(), session_id),
            )
            conn.execute(
                "DELETE FROM session_operations WHERE expires_at<=?", (time.time(),)
            )
            if conn.execute(
                "SELECT 1 FROM session_operations WHERE session_id=?", (session_id,)
            ).fetchone():
                return False
            documents = conn.execute(
                "SELECT * FROM documents WHERE session_id=?", (session_id,)
            ).fetchall()
            media = conn.execute(
                "SELECT * FROM media_assets WHERE session_id=?", (session_id,)
            ).fetchall()
            retained = set()
            for row in documents:
                retained.add(("vector", row["id"]))
            for row, kind in [(row, "document") for row in documents] + [
                (row, "media") for row in media
            ]:
                value = row["storage_url"] if kind == "document" else row["file_path"]
                if not value:
                    continue
                key = storage_service.owned_storage_key(
                    {"storage_url": value}
                    if kind == "document"
                    else {"file_path": value},
                    kind,
                )
                retained.add(("local", key))
                # Legacy rows did not record their storage backend. Clean both
                # copies when R2 is configured, including local fallback files.
                if storage_service.is_r2_active or value.startswith(
                    ("http://", "https://")
                ):
                    retained.add(("r2", key))
            if temporary:
                for kind, key in retained:
                    conn.execute(
                        "INSERT INTO session_resources VALUES (?,?,?) ON CONFLICT DO NOTHING",
                        (session_id, kind, key),
                    )
            # Normal-chat deletion may only remove processing scratch files.
            # Missing/incomplete SQL metadata is not proof that a durable object
            # or its vectors can be deleted. Keep their ownership records for
            # separately reviewed recovery/cleanup, even after this job finishes.
            resource_filter = (
                ""
                if temporary
                else " AND kind='local' AND substr(resource_key,1,8)='uploads/'"
            )
            resources = conn.execute(
                "SELECT kind,resource_key FROM session_resources WHERE session_id=?"
                + resource_filter,
                (session_id,),
            ).fetchall()
        evict_session(
            session_id, [row["id"] for row in documents], remove_references=temporary
        )
        for resource in resources:
            kind, key = resource["kind"], resource["resource_key"]
            if kind == "vector":
                vector_store_repo.delete_document(key, raise_on_error=True)
            else:
                storage_service.delete_owned_file(key, backend=kind)
            with get_db_connection(write=True) as conn:
                conn.execute(
                    "DELETE FROM session_resources WHERE session_id=? AND kind=? AND resource_key=?",
                    (session_id, kind, key),
                )
        with get_db_connection(write=True) as conn:
            if conn.execute(
                "SELECT 1 FROM session_resources WHERE session_id=?" + resource_filter,
                (session_id,),
            ).fetchone():
                return False
            for table in ("documents", "media_assets"):
                if temporary:
                    kind = "document" if table == "documents" else "media"
                    conn.execute(
                        f"DELETE FROM download_tickets WHERE kind=? AND asset_id IN "
                        f"(SELECT id FROM {table} WHERE session_id=?)",
                        (kind, session_id),
                    )
                    conn.execute(
                        f"DELETE FROM {table} WHERE session_id=?", (session_id,)
                    )
            conn.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
            conn.execute("DELETE FROM chat_sessions WHERE id=?", (session_id,))
            conn.execute(
                "UPDATE session_deletions SET completed_at=? WHERE session_id=?",
                (utc_now(), session_id),
            )
        evict_session(
            session_id, [row["id"] for row in documents], remove_references=temporary
        )
        return True
    except Exception:
        logger.warning("Chat cleanup is pending and will be retried", exc_info=True)
        return False


def purge_expired_sessions() -> int:
    purge_failed_uploads()
    with get_db_connection(write=True) as conn:
        conn.execute(
            "INSERT INTO session_deletions (session_id,user_id,requested_at) "
            "SELECT id,user_id,? FROM chat_sessions WHERE expires_at IS NOT NULL AND expires_at<=? "
            "ON CONFLICT DO NOTHING",
            (utc_now(), utc_now()),
        )
        jobs = conn.execute(
            "SELECT session_id FROM session_deletions WHERE completed_at IS NULL "
            "ORDER BY last_attempt_at,requested_at LIMIT 100"
        ).fetchall()
    count = sum(cleanup_session(row["session_id"]) for row in jobs)
    prune_local_cache()
    return count


def prune_local_cache() -> None:
    """Every API worker discards stale state, even if another worker cleaned SQL."""
    from app.repositories.session_store import session_store_repo

    for table, cache in (
        ("chat_sessions", session_store_repo._sessions),
        ("documents", session_store_repo._documents),
    ):
        cached_ids = list(cache)
        for offset in range(0, len(cached_ids), 400):
            batch = cached_ids[offset : offset + 400]
            placeholders = ",".join("?" for _ in batch)
            if table == "chat_sessions":
                query = (
                    f"SELECT s.id FROM chat_sessions s WHERE s.id IN ({placeholders}) "
                    "AND (s.expires_at IS NULL OR s.expires_at>?) "
                    "AND NOT EXISTS (SELECT 1 FROM session_deletions x WHERE x.session_id=s.id)"
                )
            else:
                query = (
                    f"SELECT d.id FROM documents d LEFT JOIN chat_sessions s ON s.id=d.session_id "
                    f"WHERE d.id IN ({placeholders}) AND (d.session_id IS NULL OR "
                    "(s.id IS NOT NULL AND (s.expires_at IS NULL OR s.expires_at>?) "
                    "AND NOT EXISTS (SELECT 1 FROM session_deletions x WHERE x.session_id=s.id)))"
                )
            with get_db_connection() as conn:
                live_ids = {
                    row["id"]
                    for row in conn.execute(query, (*batch, utc_now())).fetchall()
                }
            for key in batch:
                if key not in live_ids:
                    cache.pop(key, None)
