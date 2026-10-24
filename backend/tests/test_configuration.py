"""Isolated settings validation: no .env, application startup, or provider access.

Run: backend/venv/Scripts/python.exe -B backend/tests/test_configuration.py
"""

import ast
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from pydantic import ValidationError

BACKEND = Path(__file__).resolve().parents[1]


def settings_class():
    path = BACKEND / "app/core/config.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    nodes = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "settings"
            for target in node.targets
        ):
            break
        nodes.append(node)
    namespace = {"__file__": str(path), "__name__": "isolated_settings"}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), namespace)
    return namespace["Settings"]


Settings = settings_class()


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.directory = tempfile.TemporaryDirectory(prefix="contexify-config-")
        self.addCleanup(self.directory.cleanup)

    def config(self, **values):
        return Settings(_env_file=None, DATA_DIR=Path(self.directory.name), **values)

    def cloud(self):
        return dict(
            DB_MODE="cloud",
            TURSO_DATABASE_URL="libsql://fixture.invalid",
            TURSO_AUTH_TOKEN="fixture-token",
            PINECONE_API_KEY="fixture-key",
            PINECONE_INDEX_NAME="fixture-index",
        )

    def r2(self):
        return dict(
            CLOUDFLARE_R2_ACCOUNT_ID="fixture-account",
            CLOUDFLARE_R2_ACCESS_KEY_ID="fixture-key",
            CLOUDFLARE_R2_SECRET_ACCESS_KEY="fixture-secret",
        )

    def test_fresh_local_install_needs_no_cloud_credentials_or_directories(self):
        config = self.config()
        self.assertEqual(config.DB_MODE, "local")
        self.assertEqual(config.STORAGE_MODE, "local")
        self.assertFalse(config.is_cloudflare_r2_configured)
        self.assertFalse(config.CHROMA_PERSIST_DIR.exists())

    def test_cloud_credentials_are_required_without_exposing_values(self):
        for field in (
            "TURSO_DATABASE_URL",
            "TURSO_AUTH_TOKEN",
            "PINECONE_API_KEY",
            "PINECONE_INDEX_NAME",
        ):
            values = self.cloud()
            values[field] = "  "
            with self.subTest(field=field), self.assertRaises(ValidationError) as error:
                self.config(**values)
            self.assertIn(field, str(error.exception))
            self.assertNotIn("fixture-token", str(error.exception))
            self.assertNotIn("fixture-key", str(error.exception))

    def test_explicit_mixed_backends_and_legacy_aliases(self):
        for mode in ("cloud", " TURSO-PINECONE ", "production", "turso", "pinecone"):
            values = self.cloud()
            values["DB_MODE"] = mode
            self.assertEqual(self.config(**values).DB_MODE, "cloud")
        self.config(DB_MODE="cloud", DATABASE_TYPE="sqlite", VECTOR_STORE_TYPE="chroma")
        self.config(
            DATABASE_TYPE="turso",
            VECTOR_STORE_TYPE="chromadb",
            TURSO_DATABASE_URL="libsql://fixture.invalid",
            TURSO_AUTH_TOKEN="fixture",
        )
        self.config(
            DATABASE_TYPE="sqlite",
            VECTOR_STORE_TYPE="pinecone",
            PINECONE_API_KEY="fixture",
        )
        for field, value in (
            ("DATABASE_TYPE", "turso"),
            ("VECTOR_STORE_TYPE", "pinecone"),
        ):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                self.config(**{field: value})

    def test_resource_names_are_not_treated_as_placeholder_credentials(self):
        cloud = self.cloud()
        cloud["PINECONE_INDEX_NAME"] = "changeme-index"
        self.config(**cloud)
        self.config(
            STORAGE_MODE="cloudflare",
            CLOUDFLARE_R2_BUCKET_NAME="changeme-bucket",
            **self.r2(),
        )

    def test_unknown_modes_and_placeholder_credentials_fail(self):
        for field in ("DB_MODE", "DATABASE_TYPE", "VECTOR_STORE_TYPE", "STORAGE_MODE"):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                self.config(**{field: "typo"})
        values = self.cloud()
        values["TURSO_AUTH_TOKEN"] = "paste_token_here"
        with self.assertRaises(ValidationError):
            self.config(**values)

    def test_explicit_r2_requires_complete_credentials_and_endpoint(self):
        with self.assertRaises(ValidationError):
            self.config(STORAGE_MODE="cloudflare")
        for field in self.r2():
            values = self.r2()
            values[field] = ""
            with self.subTest(field=field), self.assertRaises(ValidationError):
                self.config(STORAGE_MODE="cloudflare", **values)
        config = self.config(STORAGE_MODE="R2", **self.r2())
        self.assertTrue(config.is_cloudflare_r2_configured)
        values = self.r2()
        values.pop("CLOUDFLARE_R2_ACCOUNT_ID")
        config = self.config(
            STORAGE_MODE="cloudflare",
            CLOUDFLARE_R2_ENDPOINT_URL="https://fixture.invalid",
            **values,
        )
        self.assertTrue(config.is_cloudflare_r2_configured)

    def test_implicit_r2_preserves_existing_deployments_and_rejects_partial_setup(self):
        self.assertTrue(self.config(**self.r2()).is_cloudflare_r2_configured)
        with self.assertRaises(ValidationError):
            self.config(CLOUDFLARE_R2_ACCESS_KEY_ID="fixture-key")
        self.assertFalse(
            self.config(STORAGE_MODE="disk", **self.r2()).is_cloudflare_r2_configured
        )

    def test_backend_selectors_follow_validated_mode_not_credential_presence(self):
        for relative, name, override, remote in (
            ("db/database.py", "is_turso_configured", "DATABASE_TYPE", "turso"),
            (
                "repositories/vector_store.py",
                "is_pinecone_configured",
                "VECTOR_STORE_TYPE",
                "pinecone",
            ),
        ):
            path = BACKEND / "app" / relative
            tree = ast.parse(path.read_text(encoding="utf-8"))
            function = next(
                n
                for n in tree.body
                if isinstance(n, ast.FunctionDef) and n.name == name
            )
            for mode, explicit, expected in (
                ("local", "", False),
                ("cloud", "", True),
                ("local", remote, True),
                ("cloud", "local", False),
            ):
                with self.subTest(selector=name, mode=mode, explicit=explicit):
                    namespace: dict[str, Any] = {
                        "settings": SimpleNamespace(
                            DB_MODE=mode, **{override: explicit}
                        )
                    }
                    exec(
                        compile(
                            ast.Module(body=[function], type_ignores=[]),
                            str(path),
                            "exec",
                        ),
                        namespace,
                    )
                    self.assertEqual(namespace[name](), expected)


if __name__ == "__main__":
    unittest.main()
