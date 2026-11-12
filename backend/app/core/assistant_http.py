"""ASGI privacy/transport boundary for the isolated assistant security API."""

import json

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def assistant_validation_error(request, error: RequestValidationError):
    # Pydantic error input/context can contain secrets. Never reflect them.
    return JSONResponse(status_code=422, content={"detail": "Invalid assistant security request."})


class AssistantSecurityHTTP:
    def __init__(self, app, prefix="/api/v1/assistant"):
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope, receive, send):
        prefix = self.prefix
        if scope["type"] != "http" or not (
            scope["path"] == prefix or scope["path"].startswith(prefix + "/")
        ):
            return await self.app(scope, receive, send)

        headers = [
            (b"cache-control", b"no-store"), (b"referrer-policy", b"no-referrer"),
            (b"x-content-type-options", b"nosniff"), (b"x-frame-options", b"DENY"),
            (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
            (b"permissions-policy", b"microphone=(), camera=(), geolocation=()"),
        ]

        async def safe_send(message):
            if message["type"] == "http.response.start":
                names = {name for name, _ in headers}
                message["headers"] = [(k, v) for k, v in message.get("headers", []) if k.lower() not in names] + headers
            await send(message)

        async def reject(status, detail):
            raw = json.dumps({"detail": detail}).encode()
            await safe_send({"type": "http.response.start", "status": status,
                             "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": raw})

        if scope.get("query_string"):
            return await reject(400, "Assistant security does not accept URL parameters.")
        request_headers = {k.lower(): v for k, v in scope.get("headers", [])}
        if request_headers.get(b"content-encoding", b"identity") != b"identity":
            return await reject(415, "Compressed security requests are not supported.")
        if scope["method"] == "POST" and request_headers.get(b"content-type", b"").split(b";", 1)[0] != b"application/json":
            return await reject(415, "Use application/json for assistant security requests.")
        chunks, size = [], 0
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            body = event.get("body", b"")
            size += len(body)
            if size > 4096:
                return await reject(413, "Assistant security request is too large.")
            chunks.append(body)
            if not event.get("more_body", False):
                break
        body = b"".join(chunks)

        async def buffered_receive():
            nonlocal body
            if body is not None:
                result, body = body, None
                return {"type": "http.request", "body": result, "more_body": False}
            return await receive()

        await self.app(scope, buffered_receive, safe_send)
