"""Loopback-only Hrana HTTP fixture backed by disposable SQLite databases."""

import base64
import json
import socket
import sqlite3
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def encode(value):
    if value is None:
        return {"type": "null"}
    if isinstance(value, bytes):
        return {"type": "blob", "base64": base64.b64encode(value).decode("ascii")}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    return {"type": "float" if isinstance(value, float) else "text", "value": value}


def decode(value):
    kind = value["type"]
    if kind == "null":
        return None
    if kind == "blob":
        return base64.b64decode(value["base64"])
    if kind == "integer":
        return int(value["value"])
    return value["value"]


class _Server(ThreadingHTTPServer):
    daemon_threads = True

    def get_request(self):
        connection, address = super().get_request()
        connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        return connection, address


class TursoHTTPFixture:
    def __init__(self, database_path):
        self.database_path = database_path
        self.streams = {}
        self.lock = threading.Lock()
        self.requests = []
        self.response_override = None
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def handle(self):
                try:
                    super().handle()
                except ConnectionError:
                    # Clients deliberately abort rejected/oversized responses.
                    pass

            def log_message(self, format: str, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fixture.requests.append(
                    (self.path, body, self.headers.get("Authorization"))
                )
                if fixture.response_override:
                    status, response = fixture.response_override(self.path, body)
                else:
                    status, response = fixture.handle(self.path, body)
                raw = (
                    response
                    if isinstance(response, bytes)
                    else json.dumps(response).encode("utf-8")
                )
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = _Server(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def _open_stream(self, baton):
        with self.lock:
            if baton is not None:
                return self.streams.pop(baton, None)
        return sqlite3.connect(
            str(self.database_path()),
            isolation_level=None,
            timeout=0.01,
            check_same_thread=False,
        )

    def _save_stream(self, connection):
        baton = uuid.uuid4().hex
        with self.lock:
            self.streams[baton] = connection
        return baton

    def handle(self, path, body):
        connection = self._open_stream(body.get("baton"))
        if connection is None:
            return 400, {"error": "Invalid stream baton"}
        if path == "/v3/pipeline":
            results = []
            closed = False
            for request in body["requests"]:
                kind = request["type"]
                if kind == "close":
                    connection.close()
                    closed = True
                    response = {"type": "close"}
                elif kind == "get_autocommit":
                    response = {
                        "type": kind,
                        "is_autocommit": not connection.in_transaction,
                    }
                else:
                    raise AssertionError(f"Unexpected pipeline request: {kind}")
                results.append({"type": "ok", "response": response})
            return 200, {
                "baton": None if closed else self._save_stream(connection),
                "base_url": None,
                "results": results,
            }
        if path != "/v3/cursor":
            connection.close()
            return 404, {}
        entries = []
        for number, step in enumerate(body["batch"]["steps"]):
            condition = step.get("condition")
            if condition:
                if condition != {"type": "is_autocommit"}:
                    raise AssertionError(f"Unexpected batch condition: {condition}")
                if connection.in_transaction:
                    continue
            statement = step["stmt"]
            parameters = [decode(value) for value in statement.get("args", [])]
            if statement.get("named_args"):
                parameters = {
                    item["name"].lstrip(":@$"): decode(item["value"])
                    for item in statement["named_args"]
                }
            try:
                cursor = connection.execute(statement["sql"], parameters)
                columns = [{"name": column[0]} for column in cursor.description or []]
                entries.append({"type": "step_begin", "step": number, "cols": columns})
                if statement.get("want_rows", True):
                    entries.extend(
                        {"type": "row", "row": [encode(value) for value in row]}
                        for row in cursor.fetchall()
                    )
                entries.append(
                    {
                        "type": "step_end",
                        "affected_row_count": max(0, cursor.rowcount),
                        "last_insert_rowid": str(cursor.lastrowid)
                        if cursor.lastrowid is not None
                        else None,
                    }
                )
                cursor.close()
            except sqlite3.Error as exc:
                entries.append(
                    {
                        "type": "step_error",
                        "step": number,
                        "error": {
                            "message": str(exc),
                            "code": getattr(exc, "sqlite_errorname", "SQLITE_ERROR"),
                        },
                    }
                )
        first = {"baton": self._save_stream(connection), "base_url": None}
        return 200, (
            "\n".join(json.dumps(entry) for entry in [first, *entries]) + "\n"
        ).encode("utf-8")

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        with self.lock:
            for connection in self.streams.values():
                connection.close()
            self.streams.clear()
