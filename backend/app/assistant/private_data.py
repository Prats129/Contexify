"""Versioned authenticated encryption; key material is never stored alongside SQL data."""

import base64
import binascii
import json
import re
import secrets
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class PrivateStorageUnavailable(ValueError):
    pass


@dataclass(frozen=True)
class PrivateDataKeys:
    active: str
    keys: dict[str, bytes]

    @classmethod
    def parse(cls, encoded: str | None) -> "PrivateDataKeys":
        try:
            if not encoded or len(encoded) > 8192:
                raise ValueError()
            value = json.loads(encoded)
            if (
                set(value) != {"active", "keys"}
                or not isinstance(value["keys"], dict)
                or not 1 <= len(value["keys"]) <= 8
            ):
                raise ValueError()
            keys = {}
            for name, item in value["keys"].items():
                if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", name) or not isinstance(
                    item, str
                ):
                    raise ValueError()
                key = base64.b64decode(item, validate=True)
                if len(key) != 32:
                    raise ValueError()
                keys[name] = key
            if not isinstance(value["active"], str) or value["active"] not in keys:
                raise ValueError()
            return cls(value["active"], keys)
        except (ValueError, TypeError, KeyError, binascii.Error):
            raise PrivateStorageUnavailable(
                "Encrypted account storage is unavailable."
            ) from None

    def seal(self, plain: str, binding: str) -> tuple[str, bytes]:
        encoded = plain.encode("utf-8")
        if len(encoded) > 4096:
            raise PrivateStorageUnavailable("Private payload exceeds its limit.")
        nonce = secrets.token_bytes(12)
        aad = f"assistant-private-v1\n{self.active}\n{binding}".encode()
        return self.active, b"\x01" + nonce + AESGCM(self.keys[self.active]).encrypt(
            nonce, encoded, aad
        )

    def open(self, key_id: str, value: bytes, binding: str) -> str:
        try:
            if key_id not in self.keys or not 29 <= len(value) <= 4125 or value[0] != 1:
                raise ValueError()
            aad = f"assistant-private-v1\n{key_id}\n{binding}".encode()
            return (
                AESGCM(self.keys[key_id])
                .decrypt(value[1:13], value[13:], aad)
                .decode("utf-8")
            )
        except (ValueError, InvalidTag, UnicodeError):
            raise PrivateStorageUnavailable(
                "Private reminder recovery is unavailable."
            ) from None
