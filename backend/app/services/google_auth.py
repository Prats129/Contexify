"""Google's verifier validates the signature, audience, issuer and token lifetime."""
import secrets

import requests
from fastapi import HTTPException
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport.requests import Request
from google.oauth2 import id_token

from app.core.config import settings


def verify_google_credential(credential: str, nonce: str | None = None) -> dict:
    if not settings.GOOGLE_CLIENT_ID.strip():
        raise HTTPException(503, "Google Sign-In is not configured.")

    def transport(url, method="GET", body=None, headers=None, **kwargs):
        return Request()(url, method=method, body=body, headers=headers, timeout=10)

    try:
        claims = id_token.verify_oauth2_token(credential, transport, audience=settings.GOOGLE_CLIENT_ID.strip())
    except (TransportError, requests.RequestException):
        raise HTTPException(503, "Google verification is temporarily unavailable.") from None
    except (ValueError, GoogleAuthError):
        raise HTTPException(401, "Invalid Google credential.") from None
    if not claims.get("sub") or not claims.get("email") or claims.get("email_verified") is not True:
        raise HTTPException(401, "A verified Google email is required.")
    if nonce is not None and not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise HTTPException(401, "Invalid Google sign-in challenge.")
    return claims
