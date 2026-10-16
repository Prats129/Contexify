"""Rollback only resources belonging to a failed, unpublished upload attempt."""

import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Any, Callable, Generator, ParamSpec, TypeVar

from fastapi import HTTPException

from app.core.logging import logger
from app.db.database import get_db_connection

current_upload_attempt: ContextVar[str | None] = ContextVar(
    "upload_attempt", default=None
)
P = ParamSpec("P")
T = TypeVar("T")
LEASE_SECONDS = 300


def publish_upload(conn: Any) -> None:
    """Commit the asset and disarm its rollback in the same SQL transaction."""
    attempt_id = current_upload_attempt.get()
    if attempt_id is None:
        return
    row = conn.execute(
        "SELECT state FROM upload_attempts WHERE id=?", (attempt_id,)
    ).fetchone()
    if not row or row["state"] != "pending":
        raise HTTPException(409, "Upload expired before it completed. Please retry.")
    conn.execute("DELETE FROM upload_resources WHERE attempt_id=?", (attempt_id,))
    conn.execute("DELETE FROM upload_attempts WHERE id=?", (attempt_id,))


@contextmanager
def upload_attempt() -> Generator[None, None, None]:
    if current_upload_attempt.get() is not None:
        yield
        return
    attempt_id = uuid.uuid4().hex
    with get_db_connection(write=True) as conn:
        conn.execute(
            "INSERT INTO upload_attempts (id,expires_at) VALUES (?,?)",
            (attempt_id, time.time() + LEASE_SECONDS),
        )
    token = current_upload_attempt.set(attempt_id)
    stopped = threading.Event()

    def heartbeat() -> None:
        while not stopped.wait(30):
            try:
                with get_db_connection(write=True) as conn:
                    conn.execute(
                        "UPDATE upload_attempts SET expires_at=? WHERE id=? AND state='pending'",
                        (time.time() + LEASE_SECONDS, attempt_id),
                    )
            except Exception:
                logger.warning("Could not renew upload lease", exc_info=True)

    worker = threading.Thread(target=heartbeat, daemon=True)
    worker.start()
    try:
        yield
    finally:
        stopped.set()
        worker.join()
        current_upload_attempt.reset(token)
        try:
            # Published assets removed this row atomically with their metadata.
            # An exception, cancellation or an unpublished return leaves it here.
            with get_db_connection(write=True) as conn:
                conn.execute(
                    "UPDATE upload_attempts SET state='failed' WHERE id=? AND state='pending'",
                    (attempt_id,),
                )
            cleanup_upload(attempt_id)
        except Exception:
            # If SQL is unavailable, the pending lease expires for later recovery.
            logger.warning("Failed upload cleanup will be retried", exc_info=True)


def rollback_failed_upload(function: Callable[P, T]) -> Callable[P, T]:
    @wraps(function)
    def guarded(*args: P.args, **kwargs: P.kwargs) -> T:
        with upload_attempt():
            return function(*args, **kwargs)

    return guarded


def cleanup_upload(attempt_id: str) -> bool:
    from app.repositories.vector_store import vector_store_repo
    from app.services.storage_service import storage_service

    claimed = False
    try:
        with get_db_connection(write=True) as conn:
            job = conn.execute(
                "SELECT * FROM upload_attempts WHERE id=?", (attempt_id,)
            ).fetchone()
            if not job or (
                job["state"] != "failed" and job["expires_at"] > time.time()
            ):
                return False
            conn.execute(
                "UPDATE upload_attempts SET state='cleaning',expires_at=?,last_attempt_at=? WHERE id=?",
                (time.time() + LEASE_SECONDS, time.time(), attempt_id),
            )
            resources = conn.execute(
                "SELECT session_id,kind,resource_key FROM upload_resources WHERE attempt_id=?",
                (attempt_id,),
            ).fetchall()
        claimed = True
        for resource in resources:
            kind, key = resource["kind"], resource["resource_key"]
            if kind == "vector":
                vector_store_repo.delete_document(key, raise_on_error=True)
            else:
                storage_service.delete_owned_file(key, backend=kind)
            with get_db_connection(write=True) as conn:
                conn.execute(
                    "DELETE FROM upload_resources WHERE attempt_id=? AND kind=? AND resource_key=?",
                    (attempt_id, kind, key),
                )
                if resource["session_id"]:
                    conn.execute(
                        "DELETE FROM session_resources WHERE session_id=? AND kind=? AND resource_key=?",
                        (resource["session_id"], kind, key),
                    )
        with get_db_connection(write=True) as conn:
            conn.execute("DELETE FROM upload_attempts WHERE id=?", (attempt_id,))
        return True
    except Exception:
        logger.warning("Upload rollback is pending and will be retried", exc_info=True)
        if not claimed:
            return False
        try:
            with get_db_connection(write=True) as conn:
                conn.execute(
                    "UPDATE upload_attempts SET state='failed' WHERE id=?",
                    (attempt_id,),
                )
        except Exception:
            logger.warning(
                "Upload cleanup lease will expire automatically", exc_info=True
            )
        return False


def purge_failed_uploads() -> int:
    with get_db_connection() as conn:
        jobs = conn.execute(
            "SELECT id FROM upload_attempts WHERE state='failed' OR expires_at<=? "
            "ORDER BY last_attempt_at LIMIT 100",
            (time.time(),),
        ).fetchall()
    return sum(cleanup_upload(row["id"]) for row in jobs)
