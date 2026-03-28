"""Persistent preferences for the agent runtime."""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Final

from app.model_catalog import RECOMMENDED_LOCAL_MODEL, SUPPORTED_LOCAL_MODELS


PREFERENCES_FILE = Path(__file__).resolve().parents[1] / "data" / "preferences.json"
SUPPORTED_PERMISSIONS: Final[set[str]] = {"open_app", "open_url"}
DEFAULT_PREFERENCES: Final[dict[str, object]] = {
    "permissions": {
        "open_app": False,
        "open_url": False,
    },
    "ai": {
        "provider": "local",
        "selected_model": RECOMMENDED_LOCAL_MODEL,
    },
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


def _read_preferences() -> dict[str, object]:
    _ensure_preferences_file()

    with PREFERENCES_FILE.open("r", encoding="utf-8") as file_handle:
        loaded_preferences = json.load(file_handle)

    permissions = loaded_preferences.get("permissions", {})
    ai_preferences = loaded_preferences.get("ai", {})

    selected_model = str(
        ai_preferences.get("selected_model", RECOMMENDED_LOCAL_MODEL)
    ).strip().lower()
    if selected_model not in SUPPORTED_LOCAL_MODELS:
        selected_model = RECOMMENDED_LOCAL_MODEL

    return {
        "permissions": {
            "open_app": bool(permissions.get("open_app", False)),
            "open_url": bool(permissions.get("open_url", False)),
        },
        "ai": {
            "provider": str(ai_preferences.get("provider", "local")),
            "selected_model": selected_model,
        },
    }


def _write_preferences(preferences: dict[str, object]) -> None:
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


def get_selected_model() -> str:
    """Return the persisted default local model."""

    with _preferences_lock:
        preferences = _read_preferences()
        ai_preferences = preferences["ai"]
        return str(ai_preferences.get("selected_model", RECOMMENDED_LOCAL_MODEL))


def set_selected_model(model_name: str) -> str:
    """Persist the default local model for the companion."""

    normalized_model_name = model_name.strip().lower()
    if normalized_model_name not in SUPPORTED_LOCAL_MODELS:
        raise ValueError(f"Unsupported local model: {normalized_model_name}")

    with _preferences_lock:
        preferences = _read_preferences()
        ai_preferences = preferences["ai"]
        if not isinstance(ai_preferences, dict):
            ai_preferences = {}
            preferences["ai"] = ai_preferences

        ai_preferences["provider"] = "local"
        ai_preferences["selected_model"] = normalized_model_name
        _write_preferences(preferences)
        return str(ai_preferences["selected_model"])
