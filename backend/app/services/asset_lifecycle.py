"""Durable, narrowly scoped cleanup for explicitly deleted library assets."""

import json
import time
import uuid
from typing import Any

from app.core.logging import logger
from app.db.database import get_db_connection

LEASE_SECONDS = 300


def _live_file_reference(conn: Any, key: str) -> bool:
    """Protect shared legacy keys, normalizing locators exactly as storage does.

    New uploads use unique keys. Legacy aliases can point at the same file;
    inspect metadata in bounded pages rather than guessing from a filename.
    """
    from app.services.storage_service import storage_service

    table, columns = (
        ("documents", "storage_url")
        if key.startswith("documents/")
        else ("media_assets", "file_path,file_url")
    )
    cursor = ""
    while True:
        rows = conn.execute(
            f"SELECT id,{columns} FROM {table} WHERE id>? ORDER BY id LIMIT 200",
            (cursor,),
        ).fetchall()
        for row in rows:
            for field in columns.split(","):
                value = row[field] or ""
                if (storage_service._extract_key_from_url(value) or value) == key:
                    return True
        if len(rows) < 200:
            return False
        cursor = rows[-1]["id"]


def _evict_document(document_id: str) -> None:
    from app.repositories.session_store import session_store_repo

    with session_store_repo._cache_lock:
        session_store_repo._documents.pop(document_id, None)
        for session in session_store_repo._sessions.values():
            session.document_ids[:] = [
                key for key in session.document_ids if key != document_id
            ]


def request_asset_deletion(
    asset_id: str, kind: str, *, cleanup_now: bool = True
) -> bool:
    """Commit cleanup intent, metadata removal, and ticket revocation together."""
    from app.services.storage_service import storage_service

    if kind not in {"media", "document"}:
        raise ValueError("Unknown asset kind")
    table = "documents" if kind == "document" else "media_assets"
    with get_db_connection(write=True) as conn:
        row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (asset_id,)).fetchone()
        if not row:
            return False
        value = (
            row["storage_url"]
            if kind == "document"
            else row["file_path"] or row["file_url"]
        )
        resources = [("vector", asset_id)] if kind == "document" else []
        if value:
            key = storage_service.owned_storage_key(
                {"storage_url" if kind == "document" else "file_path": value}, kind
            )
            resources.append(("local", key))
            recorded_r2 = conn.execute(
                "SELECT 1 FROM session_resources WHERE kind='r2' AND resource_key=? LIMIT 1",
                (key,),
            ).fetchone()
            if (
                storage_service.is_r2_active
                or recorded_r2
                or value.startswith(("http://", "https://"))
            ):
                resources.append(("r2", key))
        conn.execute(
            "INSERT INTO asset_deletions (kind,asset_id,resources_json,requested_at) VALUES (?,?,?,?)",
            (kind, asset_id, json.dumps(resources), time.time()),
        )
        if kind == "document":
            conn.execute(
                "DELETE FROM session_documents WHERE document_id=?", (asset_id,)
            )
        conn.execute(
            "DELETE FROM download_tickets WHERE kind=? AND asset_id=?", (kind, asset_id)
        )
        conn.execute(f"DELETE FROM {table} WHERE id=?", (asset_id,))
    if kind == "document":
        _evict_document(asset_id)
    if cleanup_now:
        cleanup_asset(asset_id, kind)
    return True


def cleanup_asset(asset_id: str, kind: str) -> bool:
    """Retry exact resources with a leased claim and fenced progress updates."""
    from app.repositories.vector_store import vector_store_repo
    from app.services.storage_service import storage_service

    claim = uuid.uuid4().hex
    try:
        with get_db_connection(write=True) as conn:
            job = conn.execute(
                "SELECT * FROM asset_deletions WHERE kind=? AND asset_id=?",
                (kind, asset_id),
            ).fetchone()
            now = time.time()
            if not job or job["lease_expires_at"] > now:
                return False
            changed = conn.execute(
                "UPDATE asset_deletions SET claim_token=?,lease_expires_at=?,last_attempt_at=? "
                "WHERE kind=? AND asset_id=? AND lease_expires_at<=?",
                (claim, now + LEASE_SECONDS, now, kind, asset_id, now),
            ).rowcount
            if changed != 1:
                return False
            pending = json.loads(job["resources_json"])
        for resource in list(pending):
            backend, key = resource
            try:
                with get_db_connection() as conn:
                    protected = (
                        bool(
                            conn.execute(
                                "SELECT 1 FROM documents WHERE id=?", (key,)
                            ).fetchone()
                        )
                        if backend == "vector"
                        else _live_file_reference(conn, key)
                    )
                if not protected:
                    if backend == "vector":
                        vector_store_repo.delete_document(key, raise_on_error=True)
                    else:
                        storage_service.delete_owned_file(key, backend=backend)
            except Exception as error:  # noqa: BLE001 - retain intent for every provider failure
                logger.warning(
                    "Asset cleanup will be retried (%s)", type(error).__name__
                )
                continue
            pending.remove(resource)
            with get_db_connection(write=True) as conn:
                if (
                    conn.execute(
                        "UPDATE asset_deletions SET resources_json=? WHERE kind=? AND asset_id=? AND claim_token=?",
                        (json.dumps(pending), kind, asset_id, claim),
                    ).rowcount
                    != 1
                ):
                    return False
                if not protected:
                    conn.execute(
                        "DELETE FROM session_resources WHERE kind=? AND resource_key=?",
                        (backend, key),
                    )
        with get_db_connection(write=True) as conn:
            if pending:
                conn.execute(
                    "UPDATE asset_deletions SET lease_expires_at=0 WHERE kind=? AND asset_id=? AND claim_token=?",
                    (kind, asset_id, claim),
                )
                return False
            return (
                conn.execute(
                    "DELETE FROM asset_deletions WHERE kind=? AND asset_id=? AND claim_token=?",
                    (kind, asset_id, claim),
                ).rowcount
                == 1
            )
    except Exception as error:  # noqa: BLE001 - an expired lease recovers interrupted cleanup
        logger.warning("Asset cleanup remains pending (%s)", type(error).__name__)
        return False


def purge_deleted_assets() -> int:
    with get_db_connection() as conn:
        jobs = conn.execute(
            "SELECT kind,asset_id FROM asset_deletions WHERE lease_expires_at<=? "
            "ORDER BY last_attempt_at,requested_at LIMIT 100",
            (time.time(),),
        ).fetchall()
    return sum(cleanup_asset(row["asset_id"], row["kind"]) for row in jobs)
