"""Local test-artifact identity and source-boundary checks; no app/provider imports."""

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import TypedDict

ROOT = Path(__file__).resolve().parents[1]
VERSION_CODE = 9
VERSION_NAME = "1.4.3-assistant-test9"
APK_FILENAME = "Contexify-Assistant-M8-Wake-Test-1.4.3-9.apk"
SOURCE_DIRS = (
    "mobile/src",
    "mobile/modules",
    "mobile/plugins",
    "mobile/assets",
    "packages/assistant-core/src",
    "mobile/android/app/src",
)
SOURCE_FILES = (
    "scripts/assistant_artifact.py",
    "scripts/assistant_wake_model.py",
    "scripts/assistant_local_android.py",
    "scripts/inspect_assistant_local_apk.py",
    "scripts/build-assistant-local.ps1",
    "mobile/App.tsx",
    "mobile/index.ts",
    "mobile/app.config.js",
    "mobile/app.json",
    "mobile/package.json",
    "mobile/package-lock.json",
    "mobile/metro.config.js",
    "mobile/react-native.config.js",
    "packages/assistant-core/package.json",
    "mobile/android/app/build.gradle",
    "mobile/android/build.gradle",
    "mobile/android/settings.gradle",
    "mobile/android/gradle.properties",
)
EXCLUDED_DIRS = {
    "node_modules",
    "build",
    ".gradle",
    ".cxx",
    "Pods",
    ".build",
    "__pycache__",
}


class SourceProof(TypedDict):
    schema_version: int
    source_sha256: str
    source_files: int


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def matching_artifact(apk: Path, source: Path) -> str:
    """A previous valid APK must not stand in for a new build's output."""
    if not apk.is_file() or not source.is_file():
        raise ValueError("Both the copied APK and current build output are required.")
    result = digest(apk)
    if result != digest(source):
        raise ValueError("The inspected APK does not match the current build output.")
    return result


def source_snapshot(root: Path = ROOT) -> SourceProof:
    root = root.resolve()
    paths = set()

    def include(path: Path):
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError("Source inputs must stay inside the project.")
        paths.add(path.relative_to(root).as_posix())

    for relative in SOURCE_FILES:
        path = root / relative
        if not path.is_file():
            raise ValueError("Required source input is missing.")
        include(path)
    for relative in SOURCE_DIRS:
        directory = root / relative
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError("Required source directory is missing or linked.")
        for current, directories, files in os.walk(directory, followlinks=False):
            directories[:] = sorted(
                name for name in directories if name not in EXCLUDED_DIRS
            )
            if any((Path(current) / name).is_symlink() for name in directories):
                raise ValueError("Linked source directories are not supported.")
            for name in files:
                # Dotenv is deliberately disabled by the build launcher, never collect its data.
                if name.startswith(".env") or name.endswith((".pyc", ".log")):
                    continue
                include(Path(current) / name)
    fingerprint = hashlib.sha256()
    for relative in sorted(paths):
        fingerprint.update(relative.encode("utf-8") + b"\0")
        fingerprint.update(digest(root / relative).encode("ascii") + b"\n")
    return {
        "schema_version": 1,
        "source_sha256": fingerprint.hexdigest(),
        "source_files": len(paths),
    }


def read_snapshot(path: Path) -> SourceProof:
    if path.stat().st_size > 4096:
        raise ValueError("Invalid source snapshot.")

    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Invalid source snapshot.")
            result[key] = value
        return result

    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_pairs)
    return validate_snapshot(value)


def validate_snapshot(value: object) -> SourceProof:
    if (
        not isinstance(value, dict)
        or set(value) != {"schema_version", "source_sha256", "source_files"}
        or type(value["schema_version"]) is not int
        or value["schema_version"] != 1
        or type(value["source_files"]) is not int
        or value["source_files"] < 1
        or not isinstance(value["source_sha256"], str)
        or len(value["source_sha256"]) != 64
        or any(char not in "0123456789abcdef" for char in value["source_sha256"])
    ):
        raise ValueError("Invalid source snapshot.")
    return {
        "schema_version": 1,
        "source_sha256": value["source_sha256"],
        "source_files": value["source_files"],
    }


def verify_snapshot(path: Path, root: Path = ROOT) -> SourceProof:
    expected = read_snapshot(path)
    if expected != source_snapshot(root):
        raise ValueError(
            "Source inputs changed during or after the build. Rebuild before delivery."
        )
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("describe")
    capture = commands.add_parser("snapshot")
    capture.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "describe":
        print(
            json.dumps(
                {
                    "version_code": VERSION_CODE,
                    "version_name": VERSION_NAME,
                    "apk_filename": APK_FILENAME,
                }
            )
        )
        return
    destination = args.output.resolve()
    allowed = (ROOT / "backend/.pytest_cache/assistant-local-android").resolve()
    if not allowed.is_relative_to(ROOT.resolve()) or not destination.is_relative_to(
        allowed
    ):
        parser.error("Source snapshots belong in the isolated build-state directory.")
    snapshot = source_snapshot()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as handle:
        json.dump(snapshot, handle, sort_keys=True)
    print("Source snapshot recorded; no credentials, provider request or phone access.")


if __name__ == "__main__":
    main()
