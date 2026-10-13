"""Server-issued identities and resource ownership shared by every API router."""
import hashlib
import re
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.db.database import get_db_connection

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    user_id: str
    token_hash: str
    is_guest: bool = False


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def unauthorized():
    return HTTPException(401, "Please sign in again.", headers={"WWW-Authenticate": "Bearer"})


def issue_credentials(user_id: str) -> dict:
    token = secrets.token_urlsafe(32)
    with get_db_connection() as conn:
        user = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise unauthorized()
        expires_at = time.time() + (settings.GUEST_SESSION_TTL_SECONDS if user_id.startswith("guest_") else settings.AUTH_SESSION_TTL_SECONDS)
        conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (time.time(),))
        conn.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, credential_hash, expires_at) VALUES (?, ?, ?, ?)",
            (digest(token), user_id, digest(user["password_hash"]), expires_at),
        )
    return {"access_token": token, "token_type": "bearer", "expires_at": expires_at}


def resolve_principal(token_hash: str) -> Principal:
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT a.user_id, a.credential_hash, a.expires_at, u.password_hash "
            "FROM auth_sessions a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ?",
            (token_hash,),
        ).fetchone()
    if not row or float(row["expires_at"]) <= time.time() or not secrets.compare_digest(row["credential_hash"], digest(row["password_hash"])):
        raise unauthorized()
    return Principal(row["user_id"], token_hash, row["user_id"].startswith("guest_"))


def require_principal(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> Principal:
    if credentials is None or credentials.scheme.lower() != "bearer" or len(credentials.credentials) > 512:
        raise unauthorized()
    return resolve_principal(digest(credentials.credentials))


def require_user(principal: Principal = Depends(require_principal)) -> Principal:
    if principal.is_guest:
        raise HTTPException(403, "Please sign in to use this feature.")
    return principal


def require_admin(principal: Principal = Depends(require_user)) -> Principal:
    if principal.user_id not in settings.ADMIN_USER_IDS:
        raise HTTPException(403, "Administrator access required.")
    return principal


def check_user_claim(user_id: str | None, principal: Principal):
    if user_id and user_id != principal.user_id:
        raise HTTPException(403, "User identity does not match the authenticated session.")


def check_session(session_id: str, principal: Principal):
    with get_db_connection() as conn:
        row = conn.execute("SELECT user_id, expires_at FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
    if not row or row["user_id"] != principal.user_id:
        raise HTTPException(404, "Session not found.")
    if row["expires_at"] and row["expires_at"] <= datetime.now(timezone.utc).replace(tzinfo=None).isoformat():
        raise HTTPException(404, "Session not found.")


def ensure_session(session_id: str, principal: Principal, mode="AUTO", title="New Conversation", is_temporary=False):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session_id):
        raise HTTPException(400, "Invalid session identifier.")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    temporary = principal.is_guest or is_temporary
    expiry = (now + timedelta(days=settings.TEMPORARY_CHAT_RETENTION_DAYS)).isoformat() if temporary else None
    # Never REPLACE an existing session: that can transfer ownership or delete children.
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO chat_sessions (id,user_id,title,mode,is_temporary,expires_at,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
            (session_id, principal.user_id, title, getattr(mode, "value", mode), int(temporary), expiry, now.isoformat(), now.isoformat()),
        )
    check_session(session_id, principal)


def create_guest() -> dict:
    user_id = "guest_" + uuid.uuid4().hex
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO users (id,username,email,display_name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?,?)",
            (user_id, user_id, user_id + "@guest.invalid", "Guest", "", "", datetime.now(timezone.utc).replace(tzinfo=None).isoformat()),
        )
    return {"principal_id": user_id, **issue_credentials(user_id)}


def asset_record(asset_id: str, kind: str = "media") -> dict:
    with get_db_connection() as conn:
        if kind == "document":
            row = conn.execute("SELECT id,user_id,session_id,filename,storage_url FROM documents WHERE id=?", (asset_id,)).fetchone()
        elif kind == "media":
            row = conn.execute("SELECT id,user_id,session_id,filename,file_path,file_url,mime_type FROM media_assets WHERE id=?", (asset_id,)).fetchone()
        else:
            raise HTTPException(404, "Asset not found.")
        if not row:
            return {}
        keys = ("id", "user_id", "session_id", "filename", "storage_url") if kind == "document" else ("id", "user_id", "session_id", "filename", "file_path", "file_url", "mime_type")
        return {key: row[key] for key in keys}


def check_asset(asset_id: str, principal: Principal, kind="media") -> dict:
    row = asset_record(asset_id, kind)
    if not row:
        raise HTTPException(404, "Asset not found.")
    if row["user_id"]:
        if row["user_id"] != principal.user_id:
            raise HTTPException(404, "Asset not found.")
    elif not row["session_id"]:
        # Unowned legacy assets must not be made public or assigned to a caller.
        raise HTTPException(404, "Asset not found.")
    if row["session_id"]:
        check_session(row["session_id"], principal)
    return row


def download_url(asset_id: str, principal: Principal, kind="media") -> str:
    if kind == "avatar":
        check_user_claim(asset_id, principal)
    else:
        check_asset(asset_id, principal, kind)
    ticket = secrets.token_urlsafe(32)
    with get_db_connection() as conn:
        conn.execute("DELETE FROM download_tickets WHERE expires_at <= ?", (time.time(),))
        conn.execute(
            "INSERT INTO download_tickets (ticket_hash,token_hash,asset_id,kind,expires_at) VALUES (?,?,?,?,?)",
            (digest(ticket), principal.token_hash, asset_id, kind, time.time() + settings.DOWNLOAD_TICKET_TTL_SECONDS),
        )
    return f"/api/v1/media/content/{kind}/{asset_id}?ticket={ticket}"


def download_principal(asset_id: str, kind: str, ticket: str | None, credentials: HTTPAuthorizationCredentials | None) -> Principal:
    if credentials:
        return require_principal(credentials)
    if not ticket or len(ticket) > 512:
        raise unauthorized()
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT token_hash,asset_id,kind,expires_at FROM download_tickets WHERE ticket_hash=?", (digest(ticket),)
        ).fetchone()
    if not row or row["asset_id"] != asset_id or row["kind"] != kind or float(row["expires_at"]) <= time.time():
        raise unauthorized()
    return resolve_principal(row["token_hash"])


def present_user(user, principal: Principal):
    if user.avatar_url and not user.avatar_url.startswith("https://lh3.googleusercontent.com/"):
        user = user.model_copy(update={"avatar_url": download_url(user.id, principal, "avatar")})
    return user


def present_attachment(attachment, principal: Principal):
    kind = "document" if attachment.file_type == "document" else "media"
    if not attachment.id:
        raise HTTPException(400, "Attachments require an owned asset identifier.")
    return attachment.model_copy(update={"url": download_url(attachment.id, principal, kind)})
