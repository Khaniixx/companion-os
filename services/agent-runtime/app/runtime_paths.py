"""Stable runtime paths for local data and packaged execution."""

from __future__ import annotations

import os
from pathlib import Path


_DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def runtime_data_dir() -> Path:
    """Return the persistent local data directory for the runtime."""

    override = os.getenv("COMPANION_RUNTIME_DATA_DIR")
    if override:
        return Path(override)
    return _DEFAULT_DATA_DIR


def runtime_data_path(*parts: str) -> Path:
    """Build a path underneath the persistent runtime data directory."""

    return runtime_data_dir().joinpath(*parts)
