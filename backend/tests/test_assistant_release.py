"""Offline M8 artifact/readiness tests. No app, database, provider or phone access."""

import copy
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import assistant_artifact as artifacts  # noqa: E402
import assistant_local_android as android  # noqa: E402
import assistant_release_check as release  # noqa: E402
import inspect_assistant_local_apk as inspector  # noqa: E402


class ArtifactFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="contexify-m8-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in artifacts.SOURCE_FILES:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("source fixture\n", encoding="utf-8")
        for name in artifacts.SOURCE_DIRS:
            (self.root / name).mkdir(parents=True, exist_ok=True)
        self.native = self.root / "mobile/modules/fixture/android/src/main/Policy.kt"
        self.native.parent.mkdir(parents=True)
        self.native.write_text("exact review", encoding="utf-8")

    def capture(self):
        snapshot = self.root / "before.json"
        snapshot.write_text(
            json.dumps(artifacts.source_snapshot(self.root)), encoding="utf-8"
        )
        return snapshot


class ArtifactTests(ArtifactFixture):
    def test_source_proof_is_stable_but_detects_native_edits_and_new_inputs(self):
        before = self.capture()
        self.assertEqual(
            artifacts.verify_snapshot(before, self.root),
            artifacts.source_snapshot(self.root),
        )
        self.native.write_text("changed native policy", encoding="utf-8")
        with self.assertRaises(ValueError):
            artifacts.verify_snapshot(before, self.root)
        before = self.capture()
        (self.root / "mobile/src/new-adapter.ts").write_text(
            "new adapter", encoding="utf-8"
        )
        with self.assertRaises(ValueError):
            artifacts.verify_snapshot(before, self.root)

    def test_generated_build_noise_and_dotenv_do_not_enter_proof(self):
        before = artifacts.source_snapshot(self.root)
        for name in (
            "mobile/modules/fixture/android/build/outputs/large.bin",
            "mobile/src/.env.private",
            "mobile/modules/fixture/node_modules/dependency.js",
        ):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic-private-marker", encoding="utf-8")
        self.assertEqual(artifacts.source_snapshot(self.root), before)
        logo = self.root / "mobile/assets/icon.png"
        logo.write_bytes(b"changed asset")
        self.assertNotEqual(artifacts.source_snapshot(self.root), before)

    def test_redirected_source_input_is_rejected_before_hashing(self):
        original = Path.resolve
        selected = self.root / "mobile/App.tsx"

        def resolve(path, *args, **kwargs):
            return (
                self.root.parent / "outside-input"
                if path == selected
                else original(path, *args, **kwargs)
            )

        with patch.object(Path, "resolve", resolve), self.assertRaises(ValueError):
            artifacts.source_snapshot(self.root)

    def test_missing_source_and_malformed_proofs_fail_closed(self):
        (self.root / artifacts.SOURCE_FILES[0]).unlink()
        with self.assertRaises(ValueError):
            artifacts.source_snapshot(self.root)
        for value in (
            {"schema_version": True, "source_sha256": "a" * 64, "source_files": 1},
            {"schema_version": 1, "source_sha256": "a" * 64, "source_files": 1.0},
            {"schema_version": 1, "source_sha256": "private marker", "source_files": 1},
            {
                "schema_version": 1,
                "source_sha256": "a" * 64,
                "source_files": 1,
                "approved": True,
            },
        ):
            with self.assertRaises(ValueError):
                artifacts.validate_snapshot(value)
        path = self.root / "bad.json"
        path.write_text('{"schema_version":1,"schema_version":1}', encoding="utf-8")
        with self.assertRaises(ValueError):
            artifacts.read_snapshot(path)

    def test_stale_previously_valid_apk_cannot_stand_in_for_current_build(self):
        tools = self.root / "tools"
        tools.mkdir()
        copied = tools / artifacts.APK_FILENAME
        copied.write_bytes(b"old valid artifact")
        current = self.root / "mobile/android/app/build/outputs/apk/debug/app-debug.apk"
        current.parent.mkdir(parents=True)
        current.write_bytes(b"new output not inspected")
        with (
            patch.object(inspector, "ROOT", self.root),
            patch.object(inspector, "TOOLS", tools),
            patch.object(inspector.subprocess, "run") as native,
        ):
            with self.assertRaisesRegex(ValueError, "current build"):
                inspector.inspect("192.168.137.1")
            native.assert_not_called()
        copied.write_bytes(current.read_bytes())
        self.assertEqual(
            artifacts.matching_artifact(copied, current), artifacts.digest(current)
        )
        current.write_bytes(b"concurrent next build")
        with self.assertRaises(ValueError):
            artifacts.matching_artifact(copied, current)
        with self.assertRaises(ValueError):
            artifacts.matching_artifact(copied, self.root / "missing-source.apk")

    def test_preparation_and_inspection_share_the_current_artifact_identity(self):
        state = (
            self.root
            / "backend/.pytest_cache/assistant-local-android/backend-192-168-137-1"
        )
        state.mkdir(parents=True)
        (state / "assistant-local-test-state").write_text("isolated fixture")
        (state / "ca.pem").write_text("public fixture CA")
        project = self.root / "mobile/android/app"
        (project / "build.gradle").write_text(
            "react {\n}\nandroid {\n    defaultConfig {\n        applicationId 'ai.contexify.app.assistantvolumetest'\n        versionCode 1\n        versionName \"old\"\n    }\n}\n"
        )
        application = (
            project
            / "src/main/java/ai/contexify/app/assistantvolumetest/MainApplication.kt"
        )
        application.parent.mkdir(parents=True)
        application.write_text("context = applicationContext,\n")
        debug = project / "src/debug"
        debug.mkdir(parents=True)
        (debug / "AndroidManifest.xml").write_text(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application/></manifest>'
        )
        with patch.object(android, "ROOT", self.root), redirect_stdout(io.StringIO()):
            android.prepare("192.168.137.1")
        content = (project / "build.gradle").read_text()
        self.assertIn(f'versionName "{artifacts.VERSION_NAME}"', content)
        self.assertIn(f"versionCode {artifacts.VERSION_CODE}", content)
        self.assertEqual(inspector.APK_FILENAME, artifacts.APK_FILENAME)
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str(ROOT / "scripts/assistant_artifact.py"),
                "describe",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            json.loads(result.stdout),
            {
                "version_name": artifacts.VERSION_NAME,
                "version_code": artifacts.VERSION_CODE,
                "apk_filename": inspector.APK_FILENAME,
            },
        )


class ReleaseTests(ArtifactFixture):
    def setUp(self):
        super().setUp()
        document = self.root / "docs/assistant/evidence.md"
        document.parent.mkdir(parents=True)
        document.write_text("Synthetic reviewed evidence fixture")
        self.artifact = self.root / "reviewed.apk"
        self.artifact.write_bytes(b"synthetic artifact")
        self.evidence: dict = {
            "schema_version": 1,
            "artifacts": {
                "android": artifacts.digest(self.artifact),
                "ios": None,
                "web": None,
            },
            "gates": {
                key: {
                    "status": "passed",
                    "owner": "QA",
                    "reference": "docs/assistant/evidence.md",
                }
                for key in release.GATES
            },
            "smoke": {
                "android_m7": "user_reported_pass",
                "ios_m6_m7": "deferred",
                "web_m6": "pending",
            },
            "wake": {"enabled": False, "decision": "pending"},
        }
        self.evidence["gates"]["C.ios"]["status"] = "deferred"
        self.evidence["gates"]["C.web"]["status"] = "pending"
        self.inspection = {
            "sha256": artifacts.digest(self.artifact),
            "artifact_kind": "public_release",
            "signature_verified": True,
            "source_apk_matches": True,
            "secure_store_backup_excluded": True,
            "gemini_key_bundled": False,
            "test_private_key_bundled": False,
            "test_ca_only": False,
            "package": "ai.contexify.app",
            "source_proof": artifacts.source_snapshot(self.root),
        }

    def report(self, **overrides):
        return release.readiness(
            self.evidence,
            overrides.get("platform", "android"),
            self.artifact,
            overrides.get("inspection", self.inspection),
            self.root,
        )

    def test_complete_supplied_evidence_is_still_not_runtime_authority(self):
        result = self.report()
        self.assertEqual(result["decision"], "evidence_complete")
        self.assertEqual(result["runtime_authority"], "none")
        self.assertNotIn("C.ios", result["gate_states"])
        self.assertEqual(result["smoke_states"]["ios_m6_m7"], "deferred")

    def test_test_binary_is_never_public_release_even_with_passed_gate_claims(self):
        for extra in (
            {"artifact_kind": "internal_test"},
            {"package": "ai.contexify.app.assistantvolumetest"},
            {"test_ca_only": True},
        ):
            result = self.report(inspection={**self.inspection, **extra})
            self.assertIn(
                "internal_test_artifact_not_for_public_distribution", result["blockers"]
            )
            self.assertEqual(result["decision"], "hold")

    def test_pending_failed_and_deferred_required_gates_cannot_be_waived(self):
        for key in ("A", "B", "C.android", "D", "E", "F"):
            for state in ("pending", "deferred", "failed"):
                evidence = copy.deepcopy(self.evidence)
                evidence["gates"][key]["status"] = state
                result = release.readiness(
                    evidence, "android", self.artifact, self.inspection, self.root
                )
                self.assertIn("gate_" + key, result["blockers"])

    def test_artifact_change_old_report_missing_secret_scan_and_source_drift_hold(self):
        for extra in (
            {"sha256": "0" * 64},
            {"signature_verified": 1},
            {"gemini_key_bundled": "not_checked"},
            {"test_private_key_bundled": True},
            {"source_proof": None},
        ):
            self.assertEqual(
                self.report(inspection={**self.inspection, **extra})["decision"], "hold"
            )
        self.native.write_text("changed after build")
        self.assertIn(
            "build_source_provenance_missing_or_changed", self.report()["blockers"]
        )
        self.artifact.write_bytes(b"different binary")
        self.assertIn("artifact_missing_or_changed", self.report()["blockers"])

    def test_unknown_malformed_and_unsafe_references_are_rejected(self):
        for change in (
            lambda value: value.update(approved=True),
            lambda value: value.update(schema_version=True),
            lambda value: value["gates"].pop("F"),
            lambda value: value["gates"]["A"].update(status="not_applicable"),
            lambda value: value["gates"]["A"].update(owner="unassigned"),
            lambda value: value["gates"]["A"].update(owner=" "),
            lambda value: value["gates"]["A"].update(
                reference="\\\\external-host\\private.md"
            ),
            lambda value: value["gates"]["A"].update(
                reference="docs/assistant/../../private.md"
            ),
            lambda value: value["wake"].update(enabled="true"),
        ):
            evidence = copy.deepcopy(self.evidence)
            change(evidence)
            with self.assertRaises(ValueError):
                release.readiness(
                    evidence, "android", self.artifact, self.inspection, self.root
                )

    def test_unapproved_wake_and_other_platform_claims_remain_blocked(self):
        self.evidence["wake"]["enabled"] = True
        self.assertIn("wake_approval_missing", self.report()["blockers"])
        for platform in ("ios", "web"):
            result = self.report(platform=platform)
            self.assertIn("platform_artifact_verification_pending", result["blockers"])

    def test_report_does_not_echo_supplied_reviewer_or_reference_content(self):
        self.evidence["gates"]["A"]["owner"] = "SyntheticPrivateMarker"
        result = json.dumps(self.report())
        self.assertNotIn("SyntheticPrivateMarker", result)
        self.assertNotIn("Synthetic reviewed", result)
        self.assertNotIn("reference", result)

    def test_cli_invalid_evidence_is_redacted_and_nonzero(self):
        invalid = self.root / "invalid.json"
        invalid.write_text('{"private":"synthetic-private-marker"}')
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str(ROOT / "scripts/assistant_release_check.py"),
                "--platform",
                "android",
                "--evidence",
                str(invalid),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(
            json.loads(result.stdout),
            {"decision": "invalid_evidence", "runtime_authority": "none"},
        )
        self.assertNotIn("synthetic-private-marker", result.stdout + result.stderr)

    def test_json_duplicate_fields_cannot_override_a_gate(self):
        path = self.root / "duplicates.json"
        path.write_text('{"gates":{},"gates":{"A":"passed"}}')
        with self.assertRaises(ValueError):
            release.read_document(path)


if __name__ == "__main__":
    unittest.main()
