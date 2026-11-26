"""Prepare pinned public wake assets at build time; no app/database/provider imports."""

import argparse
import hashlib
import os
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "mobile/modules/assistant-wake"
DESTINATION = MODULE / "model/assistant-wake"
MODEL = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/{MODEL}.tar.bz2"
ARCHIVE_SHA256 = "f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a"
FILES = {
    "encoder.onnx": (
        "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
        "1e721676515bcd42a186979733981213c66c80db680e1cc582dfedf3be76e678",
    ),
    "decoder.onnx": (
        "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
        "f61ebd3eed3773a44d088d53dfae92dbb6aec4839f4dcaee2d402414741663a3",
    ),
    "joiner.onnx": (
        "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
        "eae9da0c7e1e6c6a3f4cc42d167899c388f6c6701b94cb96320e4f55df79624c",
    ),
    "tokens.txt": (
        "tokens.txt",
        "fd2ded4050a55d2b1578870ba8697d02371980217806b7558bd0a5cc60f3ba53",
    ),
    "MODEL-README.md": (
        "README.md",
        "74e42d37d63acd2366b042151d576fcc0c4917a41de339414a37f1e79f4e80e2",
    ),
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check(destination: Path = DESTINATION) -> None:
    for name, (_, expected) in FILES.items():
        path = destination / name
        if (
            not path.is_file()
            or path.is_symlink()
            or digest(path.read_bytes()) != expected
        ):
            raise ValueError(
                "Wake model assets missing or changed; run assistant_wake_model.py preparation."
            )
    if (destination / "keywords.txt").read_bytes() != (
        MODULE / "keywords.txt"
    ).read_bytes():
        raise ValueError("Bundled wake keywords differ from the reviewed source.")


def prepare(archive_path: Path, destination: Path = DESTINATION) -> None:
    if archive_path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Unexpected wake model archive size.")
    if digest(archive_path.read_bytes()) != ARCHIVE_SHA256:
        raise ValueError("Wake model archive digest mismatch.")
    payloads = {}
    with tarfile.open(archive_path, "r:bz2") as archive:
        for name, (source, expected) in FILES.items():
            member = archive.getmember(f"{MODEL}/{source}")
            if not member.isfile() or not 0 < member.size <= 8 * 1024 * 1024:
                raise ValueError("Unexpected wake model member.")
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError("Missing wake model member.")
            with stream:
                payload = stream.read(8 * 1024 * 1024 + 1)
            if digest(payload) != expected:
                raise ValueError("Wake model member digest mismatch.")
            payloads[name] = payload
    payloads["keywords.txt"] = (MODULE / "keywords.txt").read_bytes()
    destination.mkdir(parents=True, exist_ok=True)
    for name, payload in payloads.items():
        target = destination / name
        if target.is_symlink():
            raise ValueError("Linked wake assets are not supported.")
        with tempfile.NamedTemporaryFile(dir=destination, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(payload)
        try:
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    check(destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    parser.add_argument(
        "--download",
        action="store_true",
        help="Explicit public-model network download.",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        check()
    elif args.archive:
        prepare(args.archive)
    elif args.download:
        # Fixed HTTPS source, bounded download, no configured credentials/endpoints.
        with tempfile.TemporaryDirectory(prefix="contexify-wake-") as directory:
            archive = Path(directory) / "model.tar.bz2"
            with (
                urllib.request.urlopen(URL, timeout=60) as response,
                archive.open("wb") as output,
            ):
                remaining = 32 * 1024 * 1024
                while chunk := response.read(min(65536, remaining + 1)):
                    remaining -= len(chunk)
                    if remaining < 0:
                        raise ValueError("Unexpected wake model download size.")
                    output.write(chunk)
            prepare(archive)
    else:
        parser.error(
            "Choose --archive, --download or --check. Runtime downloading is not supported."
        )
    print("Pinned public wake model and reviewed keywords verified.")


if __name__ == "__main__":
    main()
