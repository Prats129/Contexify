"""Shared SQL token buckets; admission is atomic across workers and processes."""

import hashlib
import ipaddress
import math
from dataclasses import dataclass
from time import time

from fastapi import Depends, HTTPException, Request

from app.core.config import settings
from app.core.logging import logger
from app.core.security import Principal, require_principal
from app.db.database import get_db_connection


@dataclass(frozen=True)
class Budget:
    scope: str
    subject: str
    capacity: int
    seconds: int


def consume_budgets(budgets: list[Budget]) -> None:
    """Spend one token in every bucket, or spend none and return HTTP 429.

    A bucket starts full and refills continuously over its configured period.
    Expired, fully refilled buckets can be discarded without losing state.
    """
    if not budgets:
        return
    keys = [
        budget.scope + ":" + hashlib.sha256(budget.subject.encode()).hexdigest()
        for budget in budgets
    ]
    retry_after = 0
    try:
        with get_db_connection(write=True) as conn:
            now = time()  # Read after acquiring the shared write lock.
            # Bound cleanup work even after a long idle period.
            conn.execute(
                "DELETE FROM rate_limit_buckets WHERE bucket_key IN "
                "(SELECT bucket_key FROM rate_limit_buckets WHERE expires_at <= ? LIMIT 100)",
                (now,),
            )
            rows = {
                row["bucket_key"]: row
                for row in conn.execute(
                    "SELECT bucket_key,tokens,updated_at FROM rate_limit_buckets "
                    f"WHERE bucket_key IN ({','.join('?' for _ in keys)})",
                    keys,
                ).fetchall()
            }
            updates = []
            for budget, key in zip(budgets, keys):
                row = rows.get(key)
                updated_at = now if row is None else max(now, float(row["updated_at"]))
                available = (
                    float(budget.capacity)
                    if row is None
                    else min(
                        budget.capacity,
                        float(row["tokens"])
                        + max(0, now - float(row["updated_at"]))
                        * budget.capacity
                        / budget.seconds,
                    )
                )
                if available + 1e-9 < 1:
                    retry_after = max(
                        retry_after,
                        math.ceil(
                            max(0, updated_at - now)
                            + (1 - available) * budget.seconds / budget.capacity
                        ),
                    )
                updates.append(
                    (
                        key,
                        max(0.0, available - 1),
                        updated_at,
                        updated_at + budget.seconds,
                    )
                )
            if not retry_after:
                conn.execute(
                    "INSERT INTO rate_limit_buckets (bucket_key,tokens,updated_at,expires_at) VALUES "
                    + ",".join("(?,?,?,?)" for _ in updates)
                    + " ON CONFLICT(bucket_key) DO UPDATE SET "
                    "tokens=excluded.tokens,updated_at=excluded.updated_at,expires_at=excluded.expires_at",
                    [value for update in updates for value in update],
                )
    except Exception:
        logger.exception("Could not check request admission limits")
        raise HTTPException(
            503, "Request checks are temporarily unavailable. Please try again later."
        ) from None
    if retry_after:
        raise HTTPException(
            429,
            f"Too many requests. Please try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after), "Cache-Control": "no-store"},
        )


def client_address(request: Request) -> str:
    """Use the server-resolved peer, never caller-supplied forwarding headers.

    Configure Uvicorn's trusted proxy IPs at deployment. IPv6 /64 addresses
    share a budget so rotating addresses within one subnet cannot bypass it.
    """
    try:
        address = ipaddress.ip_address(request.client.host if request.client else "")
    except ValueError:
        raise HTTPException(
            503, "Could not identify the client connection. Please try again later."
        ) from None
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def auth_budget(request: Request) -> Budget:
    return Budget(
        "auth-ip", client_address(request), settings.RATE_LIMIT_AUTH_PER_MINUTE, 60
    )


def require_auth_budget(request: Request) -> None:
    consume_budgets([auth_budget(request)])


def require_login_budget(request: Request, identifier: str) -> None:
    normalized = identifier.strip().lower()
    try:
        with get_db_connection() as conn:
            user = conn.execute(
                "SELECT id FROM users WHERE username=? OR email=?",
                (normalized, normalized),
            ).fetchone()
    except Exception:
        logger.exception("Could not resolve login admission identity")
        raise HTTPException(
            503, "Request checks are temporarily unavailable. Please try again later."
        ) from None
    # Username and email aliases share one budget without exposing existence.
    subject = f"user:{user['id']}" if user else f"identifier:{normalized}"
    consume_budgets(
        [
            auth_budget(request),
            Budget(
                "login-account",
                subject,
                settings.RATE_LIMIT_LOGIN_PER_15_MINUTES,
                900,
            ),
        ]
    )


def require_guest_budget(request: Request) -> None:
    consume_budgets(
        [
            auth_budget(request),
            Budget(
                "guest-ip",
                client_address(request),
                settings.RATE_LIMIT_GUEST_PER_HOUR,
                3600,
            ),
        ]
    )


def require_ai_budget(
    request: Request, principal: Principal = Depends(require_principal)
) -> Principal:
    minute_limit = (
        settings.RATE_LIMIT_GUEST_AI_PER_MINUTE
        if principal.is_guest
        else settings.RATE_LIMIT_AI_PER_MINUTE
    )
    day_limit = (
        settings.RATE_LIMIT_GUEST_AI_PER_DAY
        if principal.is_guest
        else settings.RATE_LIMIT_AI_PER_DAY
    )
    address = client_address(request)
    budgets = [
        Budget(
            "ai-ip",
            address,
            settings.RATE_LIMIT_AI_IP_PER_MINUTE,
            60,
        ),
        Budget("ai-user-minute", principal.user_id, minute_limit, 60),
        Budget("ai-user-day", principal.user_id, day_limit, 86400),
        Budget(
            "ai-global-day",
            "application",
            settings.RATE_LIMIT_AI_GLOBAL_PER_DAY,
            86400,
        ),
    ]
    if principal.is_guest:
        # Anonymous callers must not reset their allowance by minting a new ID.
        budgets.append(Budget("ai-guest-ip-day", address, day_limit, 86400))
    consume_budgets(budgets)
    return principal
