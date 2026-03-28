"""Persistent preferences for the agent runtime."""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Final


PREFERENCES_FILE = Path(__file__).resolve().parents[1] / "data" / "preferences.json"
SUPPORTED_PERMISSIONS: Final[set[str]] = {"open_app"}
DEFAULT_PREFERENCES: Final[dict[str, dict[str, bool]]] = {
    "permissions": {"open_app": False}
}

_preferences_lock = Lock()


def _validate_permission_name(permission_name: str) -> None:
    if permission_name not in SUPPORTED_PERMISSIONS:
        raise ValueError(f"Unsupported permission: {permission_name}")


def _ensure_preferences_file() -> None:
    if PREFERENCES_FILE.exists():
        return

    PREFERENCES_FILE.parent.mkdir(parents=True, exist_ok=True)
    PREFERENCES_FILE.write_text(
        json.dumps(DEFAULT_PREFERENCES, indent=2), encoding="utf-8"
    )


def _read_preferences() -> dict[str, dict[str, bool]]:
    _ensure_preferences_file()

    with PREFERENCES_FILE.open("r", encoding="utf-8") as file_handle:
        loaded_preferences = json.load(file_handle)

    permissions = loaded_preferences.get("permissions", {})
    return {
        "permissions": {
            "open_app": bool(permissions.get("open_app", False)),
        }
    }


def _write_preferences(preferences: dict[str, dict[str, bool]]) -> None:
    PREFERENCES_FILE.parent.mkdir(parents=True, exist_ok=True)
    PREFERENCES_FILE.write_text(json.dumps(preferences, indent=2), encoding="utf-8")


def get_permission(permission_name: str) -> bool:
    """Return the persisted state of a permission."""

    _validate_permission_name(permission_name)

    with _preferences_lock:
        preferences = _read_preferences()
        return preferences["permissions"].get(permission_name, False)


def set_permission(permission_name: str, granted: bool) -> bool:
    """Persist the granted state of a permission."""

    _validate_permission_name(permission_name)

    with _preferences_lock:
        preferences = _read_preferences()
        preferences["permissions"][permission_name] = granted
        _write_preferences(preferences)
        return preferences["permissions"][permission_name]
