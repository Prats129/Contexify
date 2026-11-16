"""Inspect the local standalone test APK before manual installation; no device access."""

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "backend/.pytest_cache/assistant-local-android"


def inspect(host: str):
    if not __debug__:
        raise RuntimeError(
            "Run APK inspection without Python optimization; all assertions must be enabled."
        )
    apk = TOOLS / "Contexify-Volume-Test-1.4.3.apk"
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
        "versionName='1.4.3'" in badging
        and "application-label:'Contexify Volume Test'" in badging
    )
    permissions = set(
        re.findall(r"uses-permission: name='([^']+)'", dump("permissions"))
    )
    for name in ("INTERNET", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"):
        assert "android.permission." + name in permissions
    for name in (
        "SEND_SMS",
        "CALL_PHONE",
        "READ_CONTACTS",
        "QUERY_ALL_PACKAGES",
        "WRITE_SETTINGS",
        "ACCESS_NOTIFICATION_POLICY",
        "BIND_ACCESSIBILITY_SERVICE",
    ):
        assert "android.permission." + name not in permissions
    manifest = dump("xmltree", "--file", "AndroidManifest.xml")
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
    with ZipFile(apk) as archive:
        names = archive.namelist()
        assert "assets/index.android.bundle" in names
        assert any(name.startswith("lib/arm64-v8a/") for name in names)
        assert archive.read("res/raw/assistant_local_test_ca.pem") == ca
        assert host.encode() in archive.read("assets/index.android.bundle")
        assert not any(
            "test-account.json" in name
            or "server.key" in name
            or ".env" in Path(name).name
            for name in names
        )
        for name in names:
            if not name.endswith("/"):
                assert private_key not in archive.read(name), (
                    "Test private key entered the APK."
                )
        dex = [
            archive.read(name)
            for name in names
            if re.fullmatch(r"classes\d*\.dex", name)
        ]
        for marker in (
            b"executeVolume",
            b"cancelVolume",
            b"ExecutionGate",
            b"setStreamVolume",
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
    signature = subprocess.run(
        [
            str(java),
            "-Xmx128m",
            "-jar",
            str(sdk / "lib/apksigner.jar"),
            "verify",
            "--verbose",
            "--print-certs",
            str(apk),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert "Verifies" in signature.stdout
    with apk.open("rb") as handle:
        sha = hashlib.file_digest(handle, "sha256").hexdigest()
    report = {
        "package": "ai.contexify.app.assistantvolumetest",
        "version": "1.4.3",
        "sha256": sha,
        "apk_bytes": apk.stat().st_size,
        "signature_verified": True,
        "embedded_bundle": True,
        "native_volume_code": True,
        "native_brightness_code": True,
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
    inspect(parser.parse_args().lan_host)
