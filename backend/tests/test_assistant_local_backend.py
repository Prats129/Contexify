"""Local launcher isolation and protected storage-key checks; no app startup or network."""

import base64
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
spec = importlib.util.spec_from_file_location(
    "assistant_local_backend", ROOT / "scripts/assistant_local_backend.py"
)
assert spec is not None and spec.loader is not None
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


class LocalBackendTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="contexify-local-storage-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name, value in (
            ("STATE_ROOT", self.root),
            ("STATE", self.root / "backend-fixture"),
        ):
            patched = patch.object(local, name, value)
            patched.start()
            self.addCleanup(patched.stop)

    def test_configuration_discards_inherited_secrets_and_never_writes_them(self):
        with (
            patch.dict(
                os.environ, {"ASSISTANT_PRIVATE_DATA_KEYRING": "inherited-fixture"}
            ),
            patch.object(local, "prepare_tls"),
            patch.object(sys, "path", list(sys.path)),
        ):
            local.configure()
            self.assertNotIn("ASSISTANT_PRIVATE_DATA_KEYRING", os.environ)
            config = (local.STATE / ".env.test.local").read_text(encoding="utf-8")
            self.assertNotIn("KEYRING", config)
            self.assertNotIn("inherited-fixture", config)

    def test_missing_or_oversized_key_is_rejected_without_replacement(self):
        with self.assertRaises(RuntimeError):
            local.load_private_storage_keyring()
        key_file = self.root / "private-storage/backend-fixture.dpapi"
        self.assertFalse(key_file.exists())
        key_file.parent.mkdir()
        key_file.write_bytes(b"x" * 16385)
        with self.assertRaises(RuntimeError):
            local.load_private_storage_keyring()
        self.assertEqual(key_file.stat().st_size, 16385)

    def test_explicit_storage_option_fails_before_startup_if_key_is_missing(self):
        with patch.object(local, "configure", return_value=self.root):
            with self.assertRaisesRegex(RuntimeError, "protected test-storage key"):
                local.create_app(account_storage=True)

    @unittest.skipUnless(os.name == "nt", "Windows user protection is required")
    def test_protected_key_is_validated_reused_and_never_replaced(self):
        from app.assistant.private_data import PrivateStorageUnavailable
        from app.assistant.public_evaluation import _protect

        encoded = json.dumps(
            {
                "active": "fixture",
                "keys": {"fixture": base64.b64encode(bytes(32)).decode()},
            }
        )
        key_file = self.root / "private-storage/backend-fixture.dpapi"
        key_file.parent.mkdir()
        protected = _protect(encoded.encode())
        key_file.write_bytes(protected)
        self.assertNotIn(encoded.encode(), protected)
        self.assertEqual(local.load_private_storage_keyring(), encoded)
        self.assertEqual(local.load_private_storage_keyring(), encoded)
        self.assertEqual(key_file.read_bytes(), protected)
        malformed = _protect(b"{}")
        key_file.write_bytes(malformed)
        with self.assertRaises(PrivateStorageUnavailable):
            local.load_private_storage_keyring()
        self.assertEqual(key_file.read_bytes(), malformed)
        key_file.write_bytes(b"not-a-protected-key")
        with self.assertRaises(RuntimeError):
            local.load_private_storage_keyring()
        self.assertEqual(key_file.read_bytes(), b"not-a-protected-key")


if __name__ == "__main__":
    unittest.main()
