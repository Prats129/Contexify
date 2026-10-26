"""Verify production Docker context exclusions using synthetic files only.

Run with backend/venv/Scripts/python.exe -B backend/tests/test_docker_context.py.
Requires a running Docker engine with BuildKit. No application configuration,
real secrets, provider credentials, or production data are read or copied.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class DockerContextTests(unittest.TestCase):
    def test_required_inputs_survive_and_private_files_are_excluded(self):
        self.assertIsNotNone(shutil.which("docker"), "Docker CLI is required")
        scratch = ROOT / "backend/.pytest_cache"
        self.assertTrue(scratch.resolve().is_relative_to(ROOT))
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="docker-context-", dir=scratch) as name:
            temporary = Path(name)
            context = temporary / "context"
            output = temporary / "output"
            context.mkdir()
            (context / ".dockerignore").write_text(
                (ROOT / ".dockerignore").read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            (context / "Dockerfile").write_text(
                "FROM scratch\nCOPY . /context/\n", encoding="utf-8"
            )
            required = {
                "backend/requirements.txt",
                "backend/app/main.py",
                "backend/app/services/fixture.py",
                "frontend/package.json",
                "frontend/package-lock.json",
                "frontend/.npmrc",
                "frontend/index.html",
                "frontend/tsconfig.json",
                "frontend/tsconfig.node.json",
                "frontend/vite.config.ts",
                "frontend/src/main.tsx",
                "frontend/src/types/api-contracts.ts",
                "frontend/public/fixture.svg",
            }
            excluded = {
                "backend/.env",
                "frontend/.env.production",
                "mobile/.env",
                "README.md",
                "frontend/vite.config.js",
            }
            private_names = {
                ".env",
                ".env.local",
                ".env.production",
                "production.env",
                "private.key",
                "certificate.pem",
                "certificate.p12",
                "certificate.pfx",
                "credentials.json",
                "production-service-account-key.json",
                ".aws/credentials",
                ".ssh/id_rsa",
                ".git/config",
                "node_modules/fixture.js",
                "venv/fixture.py",
                ".venv/fixture.py",
                "__pycache__/fixture.pyc",
                "fixture.pyc",
                "fixture.pyo",
                "fixture.pyd",
                "data/fixture.bin",
                "chroma_db/fixture.bin",
                "runtime.db",
                "runtime.db-wal",
                "runtime.db-shm",
                "runtime.db-journal",
                "runtime.sqlite",
                "runtime.sqlite-wal",
                "runtime.sqlite3",
                "runtime.sqlite3-wal",
                "runtime.log",
                "cache.tsbuildinfo",
            }
            for parent in (
                "backend/app/nested",
                "frontend/src/nested",
                "frontend/public/nested",
            ):
                excluded.update(f"{parent}/{private}" for private in private_names)
            for relative in required | excluded:
                target = context / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(
                    "SYNTHETIC TEST FIXTURE - NO REAL DATA\n", encoding="utf-8"
                )

            try:
                result = subprocess.run(
                    [
                        "docker",
                        "build",
                        "--network=none",
                        "--no-cache",
                        "--file",
                        str(context / "Dockerfile"),
                        "--output",
                        f"type=local,dest={output}",
                        str(context),
                    ],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=120,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
            except subprocess.TimeoutExpired:
                self.fail("Docker context check timed out; check the Docker engine")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            exported = {
                path.relative_to(output / "context").as_posix()
                for path in (output / "context").rglob("*")
                if path.is_file()
            }
            self.assertEqual(
                exported, required, "Missing required inputs or leaked private fixtures"
            )


if __name__ == "__main__":
    unittest.main()
