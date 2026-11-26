"""Offline wake supply-chain checks with synthetic fixtures; no app/provider imports."""

import hashlib
import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import assistant_wake_model as model  # noqa: E402


class WakeModelTests(unittest.TestCase):
    def test_wrong_archive_is_rejected_before_any_assets_are_written(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "wrong.tar.bz2"
            archive.write_bytes(b"untrusted archive")
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                model.prepare(archive, root / "assets")
            self.assertFalse((root / "assets").exists())

    def test_exact_members_are_verified_and_keyword_or_model_tampering_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = b"synthetic model fixture"
            (root / "keywords.txt").write_bytes(b"SYNTHETIC_KEYWORD\n")
            archive = root / "fixture.tar.bz2"
            with tarfile.open(archive, "w:bz2") as bundle:
                member = tarfile.TarInfo(f"{model.MODEL}/encoder.onnx")
                member.size = len(payload)
                bundle.addfile(member, io.BytesIO(payload))
                ignored = tarfile.TarInfo("../../outside")
                ignored.size = 1
                bundle.addfile(ignored, io.BytesIO(b"x"))
            files = {
                "encoder.onnx": ("encoder.onnx", hashlib.sha256(payload).hexdigest())
            }
            destination = root / "assets"
            with (
                patch.object(model, "MODULE", root),
                patch.object(model, "FILES", files),
                patch.object(
                    model, "ARCHIVE_SHA256", model.digest(archive.read_bytes())
                ),
            ):
                model.prepare(archive, destination)
                self.assertEqual(
                    set(p.name for p in destination.iterdir()),
                    {"encoder.onnx", "keywords.txt"},
                )
                (destination / "keywords.txt").write_bytes(b"CHANGED")
                with self.assertRaises(ValueError):
                    model.check(destination)
                model.prepare(archive, destination)
                (destination / "encoder.onnx").write_bytes(b"CHANGED")
                with self.assertRaises(ValueError):
                    model.check(destination)


if __name__ == "__main__":
    unittest.main()
