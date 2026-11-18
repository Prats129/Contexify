"""Explicit PC-only setup and public-corpus live checks; never called by an APK."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.assistant.public_evaluation import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
