"""Persistent preferences for the agent runtime."""

from __future__ import annotations

import json
from threading import Lock
from typing import Final

from app.model_catalog import RECOMMENDED_LOCAL_MODEL, SUPPORTED_LOCAL_MODELS
from app.runtime_paths import runtime_data_path


PREFERENCES_FILE = runtime_data_path("preferences.json")
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
    "personality": {
        "active_pack_id": None,
    },
    "voice": {
        "enabled": True,
        "autoplay_enabled": False,
    },
    "speech_input": {
        "enabled": False,
        "transcription_enabled": True,
        "provider": "browser",
    },
    "presence": {
        "enabled": False,
        "click_through_enabled": False,
        "anchor": "desktop-right",
    },
    "memory": {
        "long_term_memory_enabled": True,
        "summary_frequency_messages": 25,
        "cloud_backup_enabled": False,
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
    personality_preferences = loaded_preferences.get("personality", {})
    voice_preferences = loaded_preferences.get("voice", {})
    speech_input_preferences = loaded_preferences.get("speech_input", {})
    presence_preferences = loaded_preferences.get("presence", {})
    memory_preferences = loaded_preferences.get("memory", {})

    selected_model = str(
        ai_preferences.get("selected_model", RECOMMENDED_LOCAL_MODEL)
    ).strip().lower()
    if selected_model not in SUPPORTED_LOCAL_MODELS:
        selected_model = RECOMMENDED_LOCAL_MODEL

    summary_frequency_messages = int(
        memory_preferences.get("summary_frequency_messages", 25)
    )
    if summary_frequency_messages < 1:
        summary_frequency_messages = 25

    anchor = str(presence_preferences.get("anchor", "desktop-right")).strip().lower()
    if anchor not in {
        "desktop-right",
        "desktop-left",
        "active-window-right",
        "active-window-left",
        "active-window-top-right",
        "active-window-top-left",
        "workspace",
    }:
        anchor = "desktop-right"

    presence_enabled = bool(presence_preferences.get("enabled", False))
    click_through_enabled = bool(
        presence_preferences.get("click_through_enabled", False)
    )
    if not presence_enabled:
        click_through_enabled = False

    return {
        "permissions": {
            "open_app": bool(permissions.get("open_app", False)),
            "open_url": bool(permissions.get("open_url", False)),
        },
        "ai": {
            "provider": str(ai_preferences.get("provider", "local")),
            "selected_model": selected_model,
        },
        "personality": {
            "active_pack_id": (
                str(personality_preferences.get("active_pack_id")).strip()
                if personality_preferences.get("active_pack_id") is not None
                else None
            ),
        },
        "voice": {
            "enabled": bool(voice_preferences.get("enabled", True)),
            "autoplay_enabled": bool(
                voice_preferences.get("autoplay_enabled", False)
            ),
        },
        "speech_input": {
            "enabled": bool(speech_input_preferences.get("enabled", False)),
            "transcription_enabled": bool(
                speech_input_preferences.get("transcription_enabled", True)
            ),
            "provider": str(speech_input_preferences.get("provider", "browser"))
            or "browser",
        },
        "presence": {
            "enabled": presence_enabled,
            "click_through_enabled": click_through_enabled,
            "anchor": anchor,
        },
        "memory": {
            "long_term_memory_enabled": bool(
                memory_preferences.get("long_term_memory_enabled", True)
            ),
            "summary_frequency_messages": summary_frequency_messages,
            "cloud_backup_enabled": bool(
                memory_preferences.get("cloud_backup_enabled", False)
            ),
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


def get_active_pack_id() -> str | None:
    """Return the selected personality pack id, if present."""

    with _preferences_lock:
        preferences = _read_preferences()
        personality_preferences = preferences.get("personality", {})
        if not isinstance(personality_preferences, dict):
            return None

        active_pack_id = personality_preferences.get("active_pack_id")
        if active_pack_id is None:
            return None

        normalized_pack_id = str(active_pack_id).strip()
        return normalized_pack_id or None


def set_active_pack_id(pack_id: str | None) -> str | None:
    """Persist the selected active personality pack id."""

    normalized_pack_id = None if pack_id is None else pack_id.strip().lower()
    if normalized_pack_id == "":
        normalized_pack_id = None

    with _preferences_lock:
        preferences = _read_preferences()
        personality_preferences = preferences.get("personality")
        if not isinstance(personality_preferences, dict):
            personality_preferences = {}
            preferences["personality"] = personality_preferences

        personality_preferences["active_pack_id"] = normalized_pack_id
        _write_preferences(preferences)
        return normalized_pack_id


def get_voice_settings() -> dict[str, bool]:
    """Return persisted voice preferences for the active companion."""

    with _preferences_lock:
        preferences = _read_preferences()
        voice_preferences = preferences.get("voice", {})
        if not isinstance(voice_preferences, dict):
            voice_preferences = {}

        return {
            "enabled": bool(voice_preferences.get("enabled", True)),
            "autoplay_enabled": bool(
                voice_preferences.get("autoplay_enabled", False)
            ),
        }


def update_voice_settings(
    *,
    enabled: bool | None = None,
    autoplay_enabled: bool | None = None,
) -> dict[str, bool]:
    """Persist voice preferences for the active companion."""

    with _preferences_lock:
        preferences = _read_preferences()
        voice_preferences = preferences.get("voice")
        if not isinstance(voice_preferences, dict):
            voice_preferences = {}
            preferences["voice"] = voice_preferences

        if enabled is not None:
            voice_preferences["enabled"] = enabled
        if autoplay_enabled is not None:
            voice_preferences["autoplay_enabled"] = autoplay_enabled

        _write_preferences(preferences)
        return {
            "enabled": bool(voice_preferences.get("enabled", True)),
            "autoplay_enabled": bool(
                voice_preferences.get("autoplay_enabled", False)
            ),
        }


def get_speech_input_settings() -> dict[str, object]:
    """Return persisted speech-input preferences for the active companion."""

    with _preferences_lock:
        preferences = _read_preferences()
        speech_input_preferences = preferences.get("speech_input", {})
        if not isinstance(speech_input_preferences, dict):
            speech_input_preferences = {}

        return {
            "enabled": bool(speech_input_preferences.get("enabled", False)),
            "transcription_enabled": bool(
                speech_input_preferences.get("transcription_enabled", True)
            ),
            "provider": str(speech_input_preferences.get("provider", "browser"))
            or "browser",
        }


def update_speech_input_settings(
    *,
    enabled: bool | None = None,
    transcription_enabled: bool | None = None,
) -> dict[str, object]:
    """Persist speech-input preferences for the active companion."""

    with _preferences_lock:
        preferences = _read_preferences()
        speech_input_preferences = preferences.get("speech_input")
        if not isinstance(speech_input_preferences, dict):
            speech_input_preferences = {}
            preferences["speech_input"] = speech_input_preferences

        if enabled is not None:
            speech_input_preferences["enabled"] = enabled
        if transcription_enabled is not None:
            speech_input_preferences["transcription_enabled"] = (
                transcription_enabled
            )

        speech_input_preferences["provider"] = "browser"

        _write_preferences(preferences)
        return {
            "enabled": bool(speech_input_preferences.get("enabled", False)),
            "transcription_enabled": bool(
                speech_input_preferences.get("transcription_enabled", True)
            ),
            "provider": str(speech_input_preferences.get("provider", "browser"))
            or "browser",
        }


def get_presence_settings() -> dict[str, object]:
    """Return persisted desktop presence preferences for the companion."""

    with _preferences_lock:
        preferences = _read_preferences()
        presence_preferences = preferences.get("presence", {})
        if not isinstance(presence_preferences, dict):
            presence_preferences = {}

        enabled = bool(presence_preferences.get("enabled", False))
        click_through_enabled = bool(
            presence_preferences.get("click_through_enabled", False)
        )
        if not enabled:
            click_through_enabled = False

        anchor = str(presence_preferences.get("anchor", "desktop-right"))
        return {
            "enabled": enabled,
            "click_through_enabled": click_through_enabled,
            "anchor": anchor,
        }


def update_presence_settings(
    *,
    enabled: bool | None = None,
    click_through_enabled: bool | None = None,
    anchor: str | None = None,
) -> dict[str, object]:
    """Persist desktop presence preferences for the companion."""

    allowed_anchors = {
        "desktop-right",
        "desktop-left",
        "active-window-right",
        "active-window-left",
        "active-window-top-right",
        "active-window-top-left",
        "workspace",
    }
    normalized_anchor = None if anchor is None else anchor.strip().lower()
    if normalized_anchor is not None and normalized_anchor not in allowed_anchors:
        raise ValueError(f"Unsupported presence anchor: {normalized_anchor}")

    with _preferences_lock:
        preferences = _read_preferences()
        presence_preferences = preferences.get("presence")
        if not isinstance(presence_preferences, dict):
            presence_preferences = {}
            preferences["presence"] = presence_preferences

        if enabled is not None:
            presence_preferences["enabled"] = enabled
            if not enabled:
                presence_preferences["click_through_enabled"] = False
        if click_through_enabled is not None:
            current_enabled = bool(presence_preferences.get("enabled", False))
            presence_preferences["click_through_enabled"] = (
                click_through_enabled and current_enabled
            )
        if normalized_anchor is not None:
            presence_preferences["anchor"] = normalized_anchor

        _write_preferences(preferences)

        enabled_value = bool(presence_preferences.get("enabled", False))
        click_value = bool(presence_preferences.get("click_through_enabled", False))
        if not enabled_value:
            click_value = False
        return {
            "enabled": enabled_value,
            "click_through_enabled": click_value,
            "anchor": str(presence_preferences.get("anchor", "desktop-right")),
        }


def get_memory_settings() -> dict[str, object]:
    """Return persisted long-term memory and privacy settings."""

    with _preferences_lock:
        preferences = _read_preferences()
        memory_preferences = preferences.get("memory", {})
        if not isinstance(memory_preferences, dict):
            memory_preferences = {}

        return {
            "long_term_memory_enabled": bool(
                memory_preferences.get("long_term_memory_enabled", True)
            ),
            "summary_frequency_messages": int(
                memory_preferences.get("summary_frequency_messages", 25)
            ),
            "cloud_backup_enabled": bool(
                memory_preferences.get("cloud_backup_enabled", False)
            ),
        }


def update_memory_settings(
    *,
    long_term_memory_enabled: bool | None = None,
    summary_frequency_messages: int | None = None,
    cloud_backup_enabled: bool | None = None,
) -> dict[str, object]:
    """Persist long-term memory and privacy settings."""

    if summary_frequency_messages is not None and summary_frequency_messages < 1:
        raise ValueError("summary_frequency_messages must be at least 1")

    with _preferences_lock:
        preferences = _read_preferences()
        memory_preferences = preferences.get("memory")
        if not isinstance(memory_preferences, dict):
            memory_preferences = {}
            preferences["memory"] = memory_preferences

        if long_term_memory_enabled is not None:
            memory_preferences["long_term_memory_enabled"] = long_term_memory_enabled
        if summary_frequency_messages is not None:
            memory_preferences["summary_frequency_messages"] = summary_frequency_messages
        if cloud_backup_enabled is not None:
            memory_preferences["cloud_backup_enabled"] = cloud_backup_enabled

        _write_preferences(preferences)
        return {
            "long_term_memory_enabled": bool(
                memory_preferences.get("long_term_memory_enabled", True)
            ),
            "summary_frequency_messages": int(
                memory_preferences.get("summary_frequency_messages", 25)
            ),
            "cloud_backup_enabled": bool(
                memory_preferences.get("cloud_backup_enabled", False)
            ),
        }
