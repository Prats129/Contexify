"""Local assistant practice API with real auth/protocol code, isolated data and TLS.

Run with backend/venv/Scripts/python.exe -B scripts/assistant_local_backend.py.
No production dotenv, AI, email, cloud storage or external network access is used.
For manual phone testing, --lan-host binds HTTPS to the selected private PC interface.
"""

import argparse
import ipaddress
import json
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE_ROOT = ROOT / "backend/.pytest_cache/assistant-local-android"
STATE = STATE_ROOT / "backend"
ORIGIN = "https://localhost"


def prepare_tls(state: Path) -> None:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    names = ("ca.pem", "server.pem", "server.key.pem")
    present = [(state / name).is_file() for name in names]
    if all(present):
        cert = x509.load_pem_x509_certificate((state / "server.pem").read_bytes())
        if cert.not_valid_after_utc <= datetime.now(timezone.utc) + timedelta(days=1):
            raise RuntimeError(
                "Local TLS certificate is expiring; renew it and rebuild the test app's debug trust resource."
            )
        return
    if any(present):
        raise RuntimeError(
            "Incomplete local TLS state; do not silently replace the test trust identity."
        )
    now = datetime.now(timezone.utc)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, "Contexify Local Assistant Test CA")]
    )
    ca = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )
    key = ec.generate_private_key(ec.SECP256R1())
    sans = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        x509.IPAddress(ipaddress.ip_address("::1")),
    ]
    if ORIGIN != "https://localhost":
        sans.append(
            x509.IPAddress(ipaddress.ip_address(ORIGIN.removeprefix("https://")))
        )
    server = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")]))
        .issuer_name(ca.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=14))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.SubjectAlternativeName(sans), critical=False)
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )
    # Retain no CA signing key: this CA can authorize only the generated development leaf.
    (state / "ca.pem").write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (state / "server.pem").write_bytes(server.public_bytes(serialization.Encoding.PEM))
    (state / "server.key.pem").write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )


def configure() -> Path:
    STATE.mkdir(parents=True, exist_ok=True)
    marker = STATE / "assistant-local-test-state"
    if not marker.exists():
        if any(STATE.iterdir()):
            raise RuntimeError(
                "Refusing to adopt an existing unmarked state directory."
            )
        marker.write_text(
            "Contexify isolated local assistant data, not production.\n",
            encoding="utf-8",
        )
    prepare_tls(STATE)
    data = STATE / "data"
    config = STATE / ".env.test.local"
    lines = {
        "PROJECT_NAME": "Contexify isolated assistant test",
        "DATA_DIR": data.as_posix(),
        "DB_MODE": "local",
        "DATABASE_TYPE": "sqlite",
        "VECTOR_STORE_TYPE": "chromadb",
        "STORAGE_MODE": "local",
        "ASSISTANT_SECURITY_ENABLED": "true",
        "ASSISTANT_SIMULATION_ENABLED": "true",
        "ASSISTANT_EXECUTION_ENABLED": "true",
        "ASSISTANT_API_ORIGIN": ORIGIN,
        "ASSISTANT_WEB_ORIGINS": json.dumps([ORIGIN]),
        "CORS_ORIGINS": json.dumps([ORIGIN]),
    }
    config.write_text(
        "\n".join(f"{key}={value}" for key, value in lines.items()) + "\n",
        encoding="utf-8",
    )
    # Never inherit app/provider credentials; changing this process leaves the user's shell unchanged.
    allowed = {
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "SYSTEMDRIVE",
        "COMSPEC",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
    }
    retained = {
        key: value for key, value in os.environ.items() if key.upper() in allowed
    }
    os.environ.clear()
    os.environ.update(retained)
    os.environ["CONTEXIFY_ENV_FILE"] = str(config)
    sys.path.insert(0, str(ROOT / "backend"))
    return data


def deny_external_network(event, args):
    if event == "socket.getaddrinfo":
        host = args[0]
        if host not in (None, "localhost", "127.0.0.1", "::1"):
            raise PermissionError(
                "External networking is disabled for the local assistant backend."
            )
    if event == "socket.connect":
        address = args[1]
        if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1"):
            raise PermissionError(
                "External networking is disabled for the local assistant backend."
            )


def create_app():
    data = configure()
    sys.addaudithook(deny_external_network)
    from fastapi import APIRouter, FastAPI, Request
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse
    from fastapi.routing import APIRoute

    from app.api.v1.endpoints import (
        assistant,
        assistant_brightness,
        assistant_planning,
        assistant_security,
        assistant_volume,
        health,
        session,
        user,
    )
    from app.core.assistant_http import (
        AssistantSecurityHTTP,
        assistant_validation_error,
    )
    from app.core.config import settings
    from app.db.database import get_db_connection, init_db
    from app.schemas.user import UserRegisterRequest
    from app.services.user_service import user_service

    if (
        settings.DATA_DIR.resolve() != data.resolve()
        or settings.DATABASE_TYPE != "sqlite"
        or settings.STORAGE_MODE != "local"
        or settings.ASSISTANT_API_ORIGIN != ORIGIN
    ):
        raise RuntimeError("Local backend configuration did not remain isolated.")
    init_db()
    account_path = STATE / "test-account.json"
    with get_db_connection() as conn:
        exists = conn.execute(
            "SELECT id FROM users WHERE username=?", ("assistant_test",)
        ).fetchone()
    if not exists:
        account = (
            json.loads(account_path.read_text())
            if account_path.exists()
            else {
                "username": "assistant_test",
                "password": "T!9a" + secrets.token_urlsafe(18),
            }
        )
        account_path.write_text(json.dumps(account, indent=2), encoding="utf-8")
        user_service.register_user(
            UserRegisterRequest(
                username=account["username"],
                password=account["password"],
                email="assistant-test@example.invalid",
                display_name="Assistant Test",
            )
        )
    elif not account_path.is_file():
        raise RuntimeError(
            "Existing test account has no local credential record; no password is reset automatically."
        )

    app = FastAPI(
        title="Contexify isolated assistant test", docs_url=None, redoc_url=None
    )
    app.add_middleware(AssistantSecurityHTTP)

    def validation_error(request: Request, error: Exception) -> JSONResponse:
        if not isinstance(error, RequestValidationError):
            raise error
        return assistant_validation_error(request, error)

    app.add_exception_handler(RequestValidationError, validation_error)
    # Reuse actual auth and assistant handlers; expose no AI, mail, cloud or upload endpoints.
    selected = APIRouter()
    selected.routes.extend(
        route
        for route in user.router.routes
        if isinstance(route, APIRoute)
        and route.path in {"/register", "/login", "/logout", "/me", "/{user_id}"}
    )
    app.include_router(selected, prefix="/api/v1/user")
    app.include_router(session.router, prefix="/api/v1/session")
    app.include_router(health.router, prefix="/api/v1/health")
    app.include_router(assistant_security.router, prefix="/api/v1/assistant/security")
    app.include_router(assistant.router, prefix="/api/v1/assistant")
    app.include_router(assistant_volume.router, prefix="/api/v1/assistant/volume")
    app.include_router(
        assistant_brightness.router, prefix="/api/v1/assistant/brightness"
    )
    # Gate remains off; no provider binding or external network is added to this host.
    app.include_router(assistant_planning.router, prefix="/api/v1/assistant/planning")
    return app


def main():
    global STATE, ORIGIN
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument(
        "--lan-host",
        help="Explicit private LAN IPv4 address for manual phone testing without USB.",
    )
    args = parser.parse_args()
    if args.lan_host:
        host = ipaddress.ip_address(args.lan_host)
        private_networks = [
            ipaddress.ip_network(value)
            for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        ]
        if host.version != 4 or not any(
            host in network for network in private_networks
        ):
            parser.error("LAN testing requires an explicit private IPv4 address.")
        ORIGIN = "https://" + str(host)
        STATE = STATE_ROOT / ("backend-" + str(host).replace(".", "-"))
    if args.prepare_only:
        configure()
        print("Local TLS/config prepared; production dotenv was not read.")
        return
    app = create_app()
    import uvicorn

    host, port = (args.lan_host, 443) if args.lan_host else ("127.0.0.1", 8443)
    print(
        "Local assistant API: HTTPS test service; no phone debugging or remote control is used."
    )
    print(
        "Synthetic sign-in details are in the ignored backend state/test-account.json file."
    )
    uvicorn.run(
        app,
        host=host,
        port=port,
        ssl_keyfile=str(STATE / "server.key.pem"),
        ssl_certfile=str(STATE / "server.pem"),
        proxy_headers=False,
        access_log=False,
    )


if __name__ == "__main__":
    main()
