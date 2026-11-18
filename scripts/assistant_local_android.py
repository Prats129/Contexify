"""Prepare only generated Android test files for a standalone local debug APK.

No phone/ADB access. Private TLS keys and production configuration are never bundled.
Run after Expo prebuild with the isolated assistant-volume-test configuration.
"""

import argparse
import ipaddress
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "ai.contexify.app.assistantvolumetest"
ANDROID = "http://schemas.android.com/apk/res/android"
TOOLS = "http://schemas.android.com/tools"


def prepare(host: str):
    address = ipaddress.ip_address(host)
    private_networks = [
        ipaddress.ip_network(value)
        for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
    ]
    if address.version != 4 or not any(
        address in network for network in private_networks
    ):
        raise ValueError("Use the PC's private Wi-Fi IPv4 address.")
    state = (
        ROOT
        / "backend/.pytest_cache/assistant-local-android"
        / ("backend-" + str(address).replace(".", "-"))
    )
    if (
        not (state / "assistant-local-test-state").is_file()
        or not (state / "ca.pem").is_file()
    ):
        raise RuntimeError(
            "Prepare the isolated LAN backend and its certificate first."
        )
    project = ROOT / "mobile/android/app"
    gradle = project / "build.gradle"
    content = gradle.read_text(encoding="utf-8")
    if f"applicationId '{PACKAGE}'" not in content:
        raise RuntimeError(
            "Refusing to alter a native project with a different app identity."
        )
    content, versions = re.subn(
        r'(?m)^(\s*)versionName "[^"]+"$',
        r'\1versionName "1.4.3-assistant-test2"',
        content,
    )
    content, codes = re.subn(r"(?m)^(\s*)versionCode \d+$", r"\1versionCode 2", content)
    if versions != 1 or codes != 1:
        raise RuntimeError("Unsupported generated test version configuration.")
    if "debuggableVariants = []" not in content:
        content = content.replace(
            "react {",
            "react {\n    // Standalone debug test APK: embed JavaScript; no Metro/USB connection required.\n    debuggableVariants = []",
            1,
        )
        gradle.write_text(content, encoding="utf-8")
    if '\n    extraPackagerArgs = ["--max-workers", "1"]' not in content:
        content = content.replace(
            "debuggableVariants = []",
            'debuggableVariants = []\n    extraPackagerArgs = ["--max-workers", "1"]',
            1,
        )
        gradle.write_text(content, encoding="utf-8")
    if 'arguments "-DCMAKE_OBJECT_PATH_MAX=240"' not in content:
        if content.count("    defaultConfig {") != 1:
            raise RuntimeError("Unsupported generated Android default configuration.")
        # Hash long generated C++ object paths before Windows Ninja reaches its path limit.
        content = content.replace(
            "    defaultConfig {",
            '    defaultConfig {\n        externalNativeBuild { cmake { arguments "-DCMAKE_OBJECT_PATH_MAX=240" } }',
            1,
        )
    gradle.write_text(content, encoding="utf-8")
    application = (
        project
        / "src/main/java/ai/contexify/app/assistantvolumetest/MainApplication.kt"
    )
    source = application.read_text(encoding="utf-8")
    if "useDevSupport = false," not in source:
        if source.count("context = applicationContext,") != 1:
            raise RuntimeError("Unsupported generated application template.")
        source = source.replace(
            "context = applicationContext,",
            "context = applicationContext,\n      useDevSupport = false,",
            1,
        )
        application.write_text(source, encoding="utf-8")
    debug = project / "src/debug"
    raw = debug / "res/raw"
    xml = debug / "res/xml"
    raw.mkdir(parents=True, exist_ok=True)
    xml.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(state / "ca.pem", raw / "assistant_local_test_ca.pem")
    # Debug source set only; normal/release binaries retain their existing TLS policy.
    (xml / "assistant_local_network_security.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n'
        '  <base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system"/></trust-anchors></base-config>\n'
        f'  <domain-config cleartextTrafficPermitted="false"><domain includeSubdomains="false">{address}</domain>'
        '<trust-anchors><certificates src="@raw/assistant_local_test_ca"/></trust-anchors></domain-config>\n'
        "</network-security-config>\n",
        encoding="utf-8",
    )
    ET.register_namespace("android", ANDROID)
    ET.register_namespace("tools", TOOLS)
    manifest = debug / "AndroidManifest.xml"
    tree = ET.parse(manifest)
    app = tree.getroot().find("application")
    if app is None:
        raise RuntimeError("Generated debug application manifest is missing.")
    app.set(
        f"{{{ANDROID}}}networkSecurityConfig", "@xml/assistant_local_network_security"
    )
    app.set(f"{{{ANDROID}}}usesCleartextTraffic", "false")
    replace = set(app.get(f"{{{TOOLS}}}replace", "").split(",")) - {""}
    replace.update({"android:networkSecurityConfig", "android:usesCleartextTraffic"})
    app.set(f"{{{TOOLS}}}replace", ",".join(sorted(replace)))
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
    print(
        "Prepared a standalone test APK with an embedded bundle and debug-only trust for the LAN test certificate."
    )
    print(
        "No phone access, USB debugging, production trust change or TLS verification bypass is used."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan-host", required=True)
    prepare(parser.parse_args().lan_host)
