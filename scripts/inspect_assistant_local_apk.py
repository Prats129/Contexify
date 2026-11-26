"""Inspect the local standalone test APK before manual installation; no device access."""

import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

from assistant_artifact import (
    APK_FILENAME,
    VERSION_CODE,
    VERSION_NAME,
    matching_artifact,
    verify_snapshot,
)
from assistant_wake_model import (
    DESTINATION as WAKE_ASSETS,
)
from assistant_wake_model import (
    FILES as WAKE_FILES,
)
from assistant_wake_model import (
    check as check_wake_model,
)

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "backend/.pytest_cache/assistant-local-android"


def inspect(
    host: str, check_live_key: bool = False, source_snapshot: Path | None = None
):
    if not __debug__:
        raise RuntimeError(
            "Run APK inspection without Python optimization; all assertions must be enabled."
        )
    apk = TOOLS / APK_FILENAME
    built_apk = ROOT / "mobile/android/app/build/outputs/apk/debug/app-debug.apk"
    sha = matching_artifact(apk, built_apk)
    source_proof = verify_snapshot(source_snapshot, ROOT) if source_snapshot else None
    sdk = TOOLS / "sdk/build-tools/37.0.0"
    java = next((TOOLS / "jdk").glob("*/bin/java.exe"))

    def dump(*args):
        return subprocess.run(
            [str(sdk / "aapt2.exe"), "dump", *args, str(apk)],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout

    assert dump("packagename").strip() == "ai.contexify.app.assistantvolumetest"
    badging = dump("badging")
    assert (
        f"versionName='{VERSION_NAME}'" in badging
        and f"versionCode='{VERSION_CODE}'" in badging
        and "application-label:'Contexify Volume Test'" in badging
    )
    permissions = set(
        re.findall(r"uses-permission: name='([^']+)'", dump("permissions"))
    )
    for name in (
        "INTERNET",
        "RECORD_AUDIO",
        "MODIFY_AUDIO_SETTINGS",
        "POST_NOTIFICATIONS",
        "RECEIVE_BOOT_COMPLETED",
    ):
        assert "android.permission." + name in permissions
    for name in (
        "SEND_SMS",
        "CALL_PHONE",
        "READ_CONTACTS",
        "QUERY_ALL_PACKAGES",
        "WRITE_SETTINGS",
        "ACCESS_NOTIFICATION_POLICY",
        "BIND_ACCESSIBILITY_SERVICE",
        "SCHEDULE_EXACT_ALARM",
        "USE_EXACT_ALARM",
        "USE_FULL_SCREEN_INTENT",
    ):
        assert "android.permission." + name not in permissions
    assert "com.android.alarm.permission.SET_ALARM" in permissions
    manifest = dump("xmltree", "--file", "AndroidManifest.xml")
    receivers = re.findall(r"E: receiver \([^\n]+\)\n((?:\s+A:[^\n]*\n)+)", manifest)
    for name in ("ReminderAlarmReceiver", "ReminderRescheduleReceiver"):
        matching = [
            entry for entry in receivers if "ai.contexify.security." + name in entry
        ]
        assert len(matching) == 1 and re.search(
            r"exported\([^\n]+\)=false", matching[0]
        ), "Reminder receivers must be non-exported."
    resources = dump("resources")

    def resource_id(name):
        match = re.search(
            r"resource (0x[0-9a-f]+) " + re.escape(name) + r"\b", resources
        )
        assert match, "Required packaged security resource is missing."
        return match.group(1)

    for attribute, resource in (
        ("networkSecurityConfig", "xml/assistant_local_network_security"),
        ("fullBackupContent", "xml/secure_store_backup_rules"),
        ("dataExtractionRules", "xml/secure_store_data_extraction_rules"),
    ):
        assert re.search(
            re.escape(attribute) + r"\([^\n]+\)=@" + resource_id(resource), manifest
        )
    assert re.search(r"usesCleartextTraffic\([^\n]+\)=false", manifest)
    for resource, count in (
        ("secure_store_backup_rules", 1),
        ("secure_store_data_extraction_rules", 2),
    ):
        rules = dump("xmltree", "--file", "res/xml/" + resource + ".xml")
        exclusions = re.findall(
            r'E: exclude[^\n]*\n\s+A: domain="sharedpref"[^\n]*\n\s+A: path="SecureStore"',
            rules,
        )
        assert len(exclusions) == count, (
            "Stored credentials must be excluded from backup and transfer."
        )
    for key, expected in (
        ("ai.contexify.assistant.EXECUTION_ENABLED", "true"),
        ("ai.contexify.assistant.WAKE_ENABLED", "true"),
        ("expo.modules.updates.ENABLED", "false"),
    ):
        data = manifest.split(key, 1)[1].split("E: ", 1)[0]
        assert re.search(r":value\([^\n]+\)=" + expected, data)
    network = dump("xmltree", "--file", "res/xml/assistant_local_network_security.xml")
    assert host in network and network.count("cleartextTrafficPermitted=false") == 2
    assert "cleartextTrafficPermitted=true" not in network
    assert "src=@" + resource_id("raw/assistant_local_test_ca") in network
    state = TOOLS / ("backend-" + host.replace(".", "-"))
    ca = (state / "ca.pem").read_bytes()
    private_key = (state / "server.key.pem").read_bytes()
    live_key = None
    if check_live_key:
        sys.path.insert(0, str(ROOT / "backend"))
        from app.assistant.public_evaluation import load_key

        live_key = load_key().encode()
    storage_secrets = []
    storage_key_file = TOOLS / "private-storage" / f"{state.name}.dpapi"
    if storage_key_file.is_file():
        sys.path.insert(0, str(ROOT / "backend"))
        from app.assistant.private_data import PrivateDataKeys
        from app.assistant.public_evaluation import _protect

        protected = storage_key_file.read_bytes()
        encoded = _protect(protected, decrypt=True)
        storage_keys = PrivateDataKeys.parse(encoded.decode())
        storage_secrets = [protected, encoded, *storage_keys.keys.values()]
        storage_secrets.extend(
            base64.b64encode(key) for key in storage_keys.keys.values()
        )
    with ZipFile(apk) as archive:
        check_wake_model()
        for wake_file in (*WAKE_FILES, "keywords.txt"):
            assert (
                hashlib.sha256(
                    archive.read("assets/assistant-wake/" + wake_file)
                ).digest()
                == hashlib.sha256((WAKE_ASSETS / wake_file).read_bytes()).digest()
            ), "Bundled wake model differs from reviewed inputs."
        assert b"HELLO_WORLD" not in archive.read("assets/assistant-wake/keywords.txt")
        assert "lib/arm64-v8a/libsherpa-onnx-jni.so" in archive.namelist()
        assert "lib/arm64-v8a/libonnxruntime.so" in archive.namelist()
        for notice in (
            ROOT / "mobile/modules/assistant-wake/licenses/assistant-wake-notices"
        ).iterdir():
            assert (
                archive.read("assets/assistant-wake-notices/" + notice.name)
                == notice.read_bytes()
            ), "Wake license notice missing or changed."
        names = archive.namelist()
        assert "assets/index.android.bundle" in names
        assert any(name.startswith("lib/arm64-v8a/") for name in names)
        assert archive.read("res/raw/assistant_local_test_ca.pem") == ca
        assert host.encode() in archive.read("assets/index.android.bundle")
        bundle = archive.read("assets/index.android.bundle")
        assert b"Review clarified command" in bundle and b"Send command" in bundle
        for marker in (
            b"Check previous actions",
            b"executePlanV2",
            b"reconcilePlansV2",
            b"operationCapabilitiesV2",
            b"handoff requested",
            b"Enable device controls on this device",
        ):
            assert marker in bundle, "Missing M4/M5 client integration."
        for marker in (
            b"Reminders and settings",
            b"readReminders",
            b"executeReminder",
            b"Encrypted account storage",
            b"Review and create reminder",
        ):
            assert marker in bundle, "Missing private reminder client integration."
        for marker in (
            b"Alarms in Clock",
            b"executeAlarmHandoff",
            b"Review alarm request",
        ):
            assert marker in bundle, "Missing reviewed Clock handoff integration."
        for marker in (
            b"Calls and messages",
            b"Send public command",
            b"/communication-proposals",
            b"local_picker",
            b"openPlannedCommunication",
        ):
            assert marker in bundle, "Missing M7 AI/composer client integration."
        assert not any(
            "test-account.json" in name
            or "server.key" in name
            or ".env" in Path(name).name
            for name in names
        )
        for name in names:
            if not name.endswith("/"):
                content = archive.read(name)
                assert private_key not in content, "Test private key entered the APK."
                assert all(secret not in content for secret in storage_secrets), (
                    "The test private-storage key entered the APK."
                )
                assert live_key is None or live_key not in content, (
                    "The backend Gemini key entered the APK."
                )
        dex = [
            archive.read(name)
            for name in names
            if re.fullmatch(r"classes\d*\.dex", name)
        ]
        for marker in (
            b"AssistantPlatformModule",
            b"pickPhoneNumber",
            b"openCommunication",
            b"openPlannedCommunication",
            b"cancelCommunicationRequest",
        ):
            assert any(marker in data for data in dex), (
                "Missing M7 native composer code."
            )
        for marker in (
            b"executeVolume",
            b"cancelVolume",
            b"ExecutionGate",
            b"setStreamVolume",
            b"readVolumeContext",
            b"executeVolumeFromContext",
            b"VolumeContextStore",
        ):
            assert any(marker in data for data in dex), "Missing native volume code."
        for marker in (
            b"executeBrightness",
            b"cancelBrightness",
            b"AppBrightnessControl",
            b"screenBrightness",
        ):
            assert any(marker in data for data in dex), (
                "Missing native app-window brightness code."
            )
        for marker in (
            b"executePlanV2",
            b"reconcilePlansV2",
            b"PlanCoordinator",
            b"PlanRecoveryStore",
            b"RecoveryCipher",
            b"validateOperationBinding",
            b"/operations/identity",
            b"/operations/status",
        ):
            assert any(marker in data for data in dex), (
                "Missing M4 native execution/recovery code."
            )
        for marker in (
            b"operationCapabilitiesV2",
            b"ReviewedHandoffExecutor",
            b"AlarmHandoff",
            b"AlarmRequest",
            b"executeAlarmHandoff",
            b"ApplicationHandoff",
            b"ApplicationTarget",
            b"ReviewedApplications",
            b"NativeControlProtocol",
            b"android_application_handoff",
            b"handoff_requested",
        ):
            assert any(marker in data for data in dex), (
                "Missing M5 reviewed application-handoff code."
            )
        for marker in (
            b"ReminderController",
            b"ReminderVault",
            b"ReminderSchedule",
            b"ReminderAlarms",
            b"ReminderAlarmReceiver",
            b"ReminderRescheduleReceiver",
            b"setAndAllowWhileIdle",
            b"android_owned_reminder",
        ):
            assert any(marker in data for data in dex), (
                "Missing native owned-reminder code."
            )

    def verify_signature(path: Path) -> str:
        result = subprocess.run(
            [
                str(java),
                "-Xmx128m",
                "-jar",
                str(sdk / "lib/apksigner.jar"),
                "verify",
                "--verbose",
                "--print-certs",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        assert "Verifies" in result.stdout
        assert re.search(r"^Number of signers: 1$", result.stdout, re.MULTILINE)
        certificate = set(
            re.findall(
                r"^(?:Signer #\d+|V\d(?:\.\d+)? Signer:) certificate SHA-256 digest: ([0-9a-f]{64})$",
                result.stdout,
                re.MULTILINE,
            )
        )
        assert len(certificate) == 1, (
            "Expected exactly one verified APK signing identity."
        )
        return certificate.pop()

    certificate = verify_signature(apk)
    previous_apk = TOOLS / "Contexify-Assistant-M5-Reminders-Test-1.4.3-5.apk"
    if previous_apk.is_file():
        assert verify_signature(previous_apk) == certificate, (
            "Test update signing identity changed."
        )
    if matching_artifact(apk, built_apk) != sha:
        raise ValueError(
            "APK changed during inspection. Inspect the rebuilt artifact again."
        )
    if source_snapshot and verify_snapshot(source_snapshot, ROOT) != source_proof:
        raise ValueError("Source snapshot changed during inspection.")
    report = {
        "artifact_kind": "internal_test",
        "package": "ai.contexify.app.assistantvolumetest",
        "version": VERSION_NAME,
        "version_code": VERSION_CODE,
        "sha256": sha,
        "apk_bytes": apk.stat().st_size,
        "signature_verified": True,
        "source_apk_matches": True,
        "source_proof": source_proof,
        "signer_sha256": certificate,
        "previous_test_signer_matches": True
        if previous_apk.is_file()
        else "not_checked",
        "embedded_bundle": True,
        "native_volume_code": True,
        "native_brightness_code": True,
        "native_context_code": True,
        "native_m4_code": True,
        "m4_client_integration": True,
        "native_m5_code": True,
        "m5_client_integration": True,
        "native_reminder_code": True,
        "reminder_client_integration": True,
        "native_m7_code": True,
        "foreground_wake_bundled": True,
        "wake_keyword": "HEY_CONTEXIFY",
        "m7_ai_client_integration": True,
        "reminder_receivers_not_exported": True,
        "exact_alarm_permissions_absent": True,
        "gemini_key_bundled": False if check_live_key else "not_checked",
        "test_ca_only": True,
        "test_private_key_bundled": False,
        "secure_store_backup_excluded": True,
        "phone_acceptance": "pending",
    }
    (TOOLS / "apk-inspection.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(
        "Local test APK identity, signature, permissions, execution gate, embedded bundle and test TLS resource verified."
    )
    print("APK SHA-256:", sha)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan-host", required=True)
    parser.add_argument("--check-live-key", action="store_true")
    parser.add_argument("--source-snapshot", type=Path)
    args = parser.parse_args()
    inspect(args.lan_host, args.check_live_key, args.source_snapshot)
