"""Read-only assistant release evidence check. Never grants runtime authority or deploys."""

import argparse
import json
import re
from pathlib import Path

from assistant_artifact import ROOT, digest, source_snapshot, validate_snapshot

GATES = {"A", "B", "C.android", "C.ios", "C.web", "D", "E", "F"}
STATUSES = {"pending", "deferred", "failed", "passed"}
HEX = re.compile(r"[0-9a-f]{64}")


def read_document(path: Path) -> dict:
    if path.stat().st_size > 131072:
        raise ValueError("Readiness input exceeds its limit.")

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate readiness field.")
            result[key] = value
        return result

    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs)
    if not isinstance(value, dict):
        raise ValueError("Invalid readiness document.")
    return value


def validate_evidence(value: dict, root: Path):
    if set(value) != {"schema_version", "artifacts", "gates", "smoke", "wake"}:
        raise ValueError("Invalid evidence fields.")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise ValueError("Unsupported evidence version.")
    artifacts, gates = value["artifacts"], value["gates"]
    if not isinstance(artifacts, dict) or set(artifacts) != {"android", "ios", "web"}:
        raise ValueError("Invalid artifact evidence.")
    if any(
        item is not None and (not isinstance(item, str) or not HEX.fullmatch(item))
        for item in artifacts.values()
    ):
        raise ValueError("Invalid artifact fingerprint.")
    if not isinstance(gates, dict) or set(gates) != GATES:
        raise ValueError("Every preserved release gate needs an explicit state.")
    for gate in gates.values():
        if not isinstance(gate, dict) or set(gate) != {"status", "owner", "reference"}:
            raise ValueError("Invalid gate evidence.")
        if not isinstance(gate["status"], str) or gate["status"] not in STATUSES:
            raise ValueError("Invalid gate state.")
        if (
            not isinstance(gate["owner"], str)
            or not re.fullmatch(r"[A-Za-z0-9 _-]{1,64}", gate["owner"])
            or not gate["owner"].strip()
            or gate["owner"] != gate["owner"].strip()
        ):
            raise ValueError("Invalid evidence owner.")
        reference = gate["reference"]
        if (
            not isinstance(reference, str)
            or len(reference) > 200
            or not re.fullmatch(r"docs/assistant/[A-Za-z0-9_./-]+\.md", reference)
            or ".." in reference.split("/")
        ):
            raise ValueError("Invalid evidence reference.")
        path = (root / reference).resolve()
        if (
            not path.is_relative_to(root.resolve())
            or not path.is_relative_to((root / "docs/assistant").resolve())
            or not path.is_file()
        ):
            raise ValueError(
                "Gate references must be existing assistant documentation."
            )
        if gate["status"] == "passed" and gate["owner"].lower() == "unassigned":
            raise ValueError("A passed gate needs an assigned reviewer.")
    smoke = value["smoke"]
    if not isinstance(smoke, dict) or set(smoke) != {
        "android_m7",
        "ios_m6_m7",
        "web_m6",
    }:
        raise ValueError("Invalid smoke evidence.")
    if any(
        not isinstance(item, str)
        or item not in {"user_reported_pass", "pending", "deferred", "failed"}
        for item in smoke.values()
    ):
        raise ValueError("Invalid smoke state.")
    wake = value["wake"]
    if (
        not isinstance(wake, dict)
        or set(wake) != {"enabled", "decision"}
        or type(wake["enabled"]) is not bool
    ):
        raise ValueError("Invalid wake decision.")
    if wake["decision"] not in ("pending", "approved", "deferred"):
        raise ValueError("Invalid wake decision.")


def readiness(
    evidence: dict,
    platform: str,
    artifact: Path | None,
    inspection: dict | None,
    root: Path = ROOT,
) -> dict:
    validate_evidence(evidence, root)
    if platform not in ("android", "ios", "web"):
        raise ValueError("Unsupported platform.")
    required = ("A", "B", "C." + platform, "D", "E", "F")
    blockers = [
        "gate_" + gate
        for gate in required
        if evidence["gates"][gate]["status"] != "passed"
    ]
    expected = evidence["artifacts"][platform]
    actual = digest(artifact) if artifact and artifact.is_file() else None
    if not expected or actual != expected:
        blockers.append("artifact_missing_or_changed")
    if platform != "android":
        # A Windows Android report cannot certify an IPA or a deployed website.
        blockers.append("platform_artifact_verification_pending")
    elif not inspection or inspection.get("sha256") != actual:
        blockers.append("artifact_inspection_missing_or_changed")
    else:
        for field in (
            "signature_verified",
            "source_apk_matches",
            "secure_store_backup_excluded",
        ):
            if inspection.get(field) is not True:
                blockers.append(field + "_missing")
        for field in ("gemini_key_bundled", "test_private_key_bundled"):
            if inspection.get(field) is not False:
                blockers.append(field + "_unchecked_or_failed")
        if (
            inspection.get("artifact_kind") != "public_release"
            or inspection.get("package") == "ai.contexify.app.assistantvolumetest"
            or inspection.get("test_ca_only") is not False
        ):
            blockers.append("internal_test_artifact_not_for_public_distribution")
        proof = inspection.get("source_proof")
        try:
            proof = validate_snapshot(proof)
            current = source_snapshot(root)
        except (OSError, ValueError):
            current = None
        if not current or proof != current:
            blockers.append("build_source_provenance_missing_or_changed")
    if evidence["wake"]["enabled"] and evidence["wake"]["decision"] != "approved":
        blockers.append("wake_approval_missing")
    return {
        "schema_version": 1,
        "platform": platform,
        "decision": "hold" if blockers else "evidence_complete",
        "runtime_authority": "none",
        "artifact_sha256": actual,
        "blockers": blockers,
        "gate_states": {key: evidence["gates"][key]["status"] for key in required},
        "smoke_states": evidence["smoke"],
        "wake_enabled": evidence["wake"]["enabled"],
        "wake_decision": evidence["wake"]["decision"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=("android", "ios", "web"), required=True)
    parser.add_argument(
        "--evidence", type=Path, default=ROOT / "docs/assistant/release-evidence.json"
    )
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--inspection", type=Path)
    args = parser.parse_args()
    try:
        result = readiness(
            read_document(args.evidence),
            args.platform,
            args.artifact,
            read_document(args.inspection) if args.inspection else None,
        )
    except (OSError, ValueError, TypeError):
        # Do not echo supplied documents, exception text, owner details or file contents.
        print(json.dumps({"decision": "invalid_evidence", "runtime_authority": "none"}))
        return 2
    print(json.dumps(result, indent=2))
    return 1 if result["decision"] == "hold" else 0


if __name__ == "__main__":
    raise SystemExit(main())
