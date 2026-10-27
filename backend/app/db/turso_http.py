"""Bounded HTTP transport for the pinned official Turso DB-API driver."""

import threading
import time
from urllib.parse import urlsplit

import httpx
from turso_serverless import Connection, OperationalError, Row
from turso_serverless.protocol import ProtocolError, ServerError
from turso_serverless.session import Session

REQUEST_TIMEOUT_SECONDS = 20.0
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
_client: httpx.Client | None = None
_client_lock = threading.Lock()


def _get_http_client() -> httpx.Client:
    global _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(
                timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=5.0),
                limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
                follow_redirects=False,
                trust_env=False,
            )
        return _client


def close_http_client() -> None:
    global _client
    with _client_lock:
        client, _client = _client, None
    if client is not None:
        client.close()


class TursoDatabaseError(OperationalError):
    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.code = code


def http_database_url(url: str) -> str:
    value = url.strip()
    for scheme in ("libsql", "turso", "wss"):
        if value.startswith(scheme + "://"):
            value = "https://" + value.split("://", 1)[1]
            break
    if value.startswith("ws://"):
        value = "http://" + value[5:]
    parsed = urlsplit(value)
    # Accessing port also validates malformed/non-numeric port values.
    parsed.port
    if (
        parsed.scheme not in ("https", "http")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (
            parsed.scheme == "http"
            and parsed.hostname not in ("localhost", "127.0.0.1", "::1")
        )
    ):
        raise ValueError(
            "Turso requires an HTTPS database URL; HTTP is allowed only on loopback."
        )
    return value.rstrip("/")


class _HTTPSession(Session):
    """Adapt the driver's HTTP hook; never patch installed third-party code.

    The hook is covered by protocol tests and tied to turso-serverless==0.1.0.
    Network/protocol failures invalidate the connection: writes and uncertain
    commits must never be replayed or silently continued on a fresh stream.
    """

    def __init__(self, url: str, token: str):
        super().__init__(http_database_url(url), auth_token=token)
        self._origin = urlsplit(self._base_url)
        self._failed = False
        self._http = _get_http_client()

    def _post(self, path: str, body: dict) -> bytes:
        closing = body.get("requests") == [{"type": "close"}]
        if self._failed and not closing:
            raise ProtocolError(
                "The database connection cannot be reused after a failed request."
            )
        deadline = time.monotonic() + REQUEST_TIMEOUT_SECONDS
        try:
            with self._http.stream(
                "POST", self._base_url + path, json=body, headers=self._headers()
            ) as response:
                if response.status_code != 200:
                    raise TursoDatabaseError(
                        f"Turso HTTP request failed (status {response.status_code}).",
                        code=f"HTTP_{response.status_code}",
                    )
                chunks = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise ProtocolError("Turso response exceeded the size limit.")
                    if time.monotonic() > deadline:
                        raise ProtocolError("Turso HTTP request timed out.")
                    chunks.append(chunk)
                return b"".join(chunks)
        except httpx.HTTPError:
            self._failed = True
            raise TursoDatabaseError(
                "Turso HTTP connection failed or timed out."
            ) from None
        except (ProtocolError, ValueError, TursoDatabaseError):
            self._failed = True
            raise

    def _update_stream(self, baton: str | None, base_url: str | None) -> None:
        if baton is not None and not isinstance(baton, str):
            raise ProtocolError("Turso returned an invalid stream identifier.")
        if base_url:
            candidate = http_database_url(base_url)
            target = urlsplit(candidate)
            same_origin = (target.scheme, target.netloc) == (
                self._origin.scheme,
                self._origin.netloc,
            )
            turso_redirect = (
                self._origin.scheme == target.scheme == "https"
                and (self._origin.hostname or "").endswith(".turso.io")
                and (target.hostname or "").endswith(".turso.io")
                and target.port in (None, 443)
            )
            if not (same_origin or turso_redirect):
                raise ProtocolError("Turso returned an untrusted database endpoint.")
            base_url = candidate
        super()._update_stream(baton, base_url)

    def execute_stmt(self, *args, **kwargs):
        if self._failed:
            raise TursoDatabaseError(
                "The database connection cannot be reused after a failed request."
            )
        try:
            result = super().execute_stmt(*args, **kwargs)
            if self._failed or (not self.autocommit and self._baton is None):
                raise ProtocolError(
                    "Turso did not preserve the active transaction stream."
                )
            return result
        except ServerError as exc:
            # Preserve machine-readable lock codes, without echoing SQL/data.
            raise TursoDatabaseError(
                "Turso rejected a SQL statement.", code=exc.code
            ) from None
        except (
            ProtocolError,
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
            IndexError,
        ):
            self._failed = True
            raise TursoDatabaseError(
                "Turso HTTP request failed; the transaction was not confirmed."
            ) from None

    def execute_pipeline(self, *args, **kwargs):
        try:
            return super().execute_pipeline(*args, **kwargs)
        except (
            ProtocolError,
            ServerError,
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
            IndexError,
        ):
            # The driver may suppress a failed autocommit-state refresh. Keep
            # the failure recorded so the statement cannot report success.
            self._failed = True
            raise


class _HTTPConnection(Connection):
    def __init__(self, session: _HTTPSession):
        super().__init__(session, isolation_level=None)
        self._http_session = session

    def commit(self):
        if self._http_session._failed:
            raise TursoDatabaseError(
                "A failed transaction cannot be committed or replayed."
            )
        super().commit()


def connect(url: str, token: str) -> Connection:
    connection = _HTTPConnection(_HTTPSession(url, token))
    connection.row_factory = Row
    return connection
