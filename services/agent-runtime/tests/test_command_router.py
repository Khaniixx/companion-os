from pathlib import Path

import app.micro_utilities as micro_utilities
import app.preferences as preferences
import app.skills.app_launcher as app_launcher
from app.core.command_router import choose_route, route_user_message


def test_choose_route_for_supported_app_commands() -> None:
    assert choose_route("open Spotify") == "app-launcher"
    assert choose_route("  Open discord  ") == "app-launcher"
    assert choose_route("open spotfy") == "app-launcher"


def test_choose_route_for_browser_queries() -> None:
    assert choose_route("search for local companion setup") == "browser-helper"
    assert choose_route("open openai.com") == "browser-helper"


def test_choose_route_for_micro_utility_requests() -> None:
    assert choose_route("set a 5 minute timer") == "micro-utilities"
    assert choose_route("remind me to stretch in 10 minutes") == "micro-utilities"
    assert choose_route("show clipboard history") == "micro-utilities"


def test_choose_route_falls_back_to_companion_chat() -> None:
    assert choose_route("open spreadsheet") == "companion-chat"
    assert choose_route("how are you today?") == "companion-chat"


def test_route_user_message_returns_app_suggestions_for_ambiguous_requests(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", tmp_path / "preferences.json")
    monkeypatch.setattr(
        app_launcher,
        "APP_LAUNCHER_STATE_FILE",
        tmp_path / "app_launcher_state.json",
    )

    result = route_user_message("open o")

    assert result.ok is False
    assert result.route == "app-launcher"
    assert "Did you mean" in result.assistant_response
    assert result.action == {
        "type": "app_suggestion",
        "suggestions": ["Discord", "Spotify"],
        "reason": "ambiguous",
    }


def test_route_user_message_uses_fuzzy_app_match_for_typos(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", tmp_path / "preferences.json")
    monkeypatch.setattr(
        app_launcher,
        "APP_LAUNCHER_STATE_FILE",
        tmp_path / "app_launcher_state.json",
    )

    result = route_user_message("open spotfy")

    assert result.ok is False
    assert result.route == "app-launcher"
    assert "allow app launches" in result.assistant_response
    assert result.action == {
        "type": "permission_required",
        "permission": "open_app",
        "target": "spotify",
        "display_name": "Spotify",
    }


def test_route_user_message_returns_permission_prompt_for_app_launcher(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)

    result = route_user_message("open Spotify")

    assert result.ok is False
    assert result.route == "app-launcher"
    assert result.user_message == "open Spotify"
    assert "allow app launches" in result.assistant_response
    assert result.action == {
        "type": "permission_required",
        "permission": "open_app",
        "target": "spotify",
        "display_name": "Spotify",
    }


def test_route_user_message_returns_browser_permission_prompt(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)

    result = route_user_message("search for companion os")

    assert result.ok is False
    assert result.route == "browser-helper"
    assert "allow browser access" in result.assistant_response
    assert result.action == {
        "type": "permission_required",
        "permission": "open_url",
    }


def test_route_user_message_runs_micro_utility(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    monkeypatch.setattr(
        micro_utilities,
        "MICRO_UTILITIES_FILE",
        tmp_path / "micro_utilities.json",
    )

    result = route_user_message("set a 5 minute timer")

    assert result.ok is True
    assert result.route == "micro-utilities"
    assert "5-minute timer" in result.assistant_response
    assert result.action is not None
    assert result.action["type"] == "created_timer"
    assert result.action["utility"]["label"] == "5-minute timer"


def test_route_user_message_returns_micro_utility_permission_prompt(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    monkeypatch.setattr(
        micro_utilities,
        "MICRO_UTILITIES_FILE",
        tmp_path / "micro_utilities.json",
    )

    result = route_user_message("run shortcut spotify")

    assert result.ok is False
    assert result.route == "micro-utilities"
    assert "once app launches are allowed" in result.assistant_response
    assert result.action == {
        "type": "permission_required",
        "permission": "open_app",
        "target": "spotify",
    }


def test_route_user_message_falls_back_to_chat_when_micro_utility_parse_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    monkeypatch.setattr(
        micro_utilities,
        "MICRO_UTILITIES_FILE",
        tmp_path / "micro_utilities.json",
    )
    monkeypatch.setattr(
        "app.core.command_router.generate_companion_reply",
        lambda _message: type(
            "Reply",
            (),
            {
                "ok": True,
                "message": "I can help with that in chat instead.",
                "provider": "ollama",
                "model": "llama3.1:8b-instruct",
                "error_code": None,
                "display_name": "Companion",
                "loading": False,
            },
        )(),
    )

    result = route_user_message("set a timer please")

    assert result.ok is True
    assert result.route == "companion-chat"
    assert result.assistant_response == "I can help with that in chat instead."
    assert result.action == {
        "type": "chat_reply",
        "provider": "ollama",
        "model": "llama3.1:8b-instruct",
        "error_code": None,
        "display_name": "Companion",
        "fallback_from": "micro-utilities",
    }


def test_route_user_message_uses_chat_fallback(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    monkeypatch.setattr(
        "app.core.command_router.generate_companion_reply",
        lambda _message: type(
            "Reply",
            (),
            {
                "ok": True,
                "message": "Local chat reply.",
                "provider": "ollama",
                "model": "llama3.1:8b-instruct",
                "error_code": None,
                "display_name": "Companion",
                "loading": False,
            },
        )(),
    )

    result = route_user_message("tell me a joke")

    assert result.ok is True
    assert result.route == "companion-chat"
    assert result.assistant_response == "Local chat reply."
    assert result.action == {
        "type": "chat_reply",
        "provider": "ollama",
        "model": "llama3.1:8b-instruct",
        "error_code": None,
        "display_name": "Companion",
    }


def test_route_user_message_returns_in_character_browser_failure(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    preferences.set_permission("open_url", True)
    monkeypatch.setattr(
        "app.core.command_router.run_browser_helper",
        lambda _message: (_ for _ in ()).throw(RuntimeError("browser offline")),
    )

    result = route_user_message("search for companion os")

    assert result.ok is False
    assert result.route == "browser-helper"
    assert "trouble reaching the browser" in result.assistant_response
    assert result.action == {
        "type": "skill_error",
        "error_code": "browser_unavailable",
        "skill": "browser-helper",
    }


def test_route_user_message_returns_in_character_app_failure(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    preferences.set_permission("open_app", True)
    monkeypatch.setattr(
        "app.core.command_router.launch_app_skill",
        lambda _app_name: (_ for _ in ()).throw(RuntimeError("launch failed")),
    )

    result = route_user_message("open Spotify")

    assert result.ok is False
    assert result.route == "app-launcher"
    assert "trouble opening that app" in result.assistant_response
    assert result.action == {
        "type": "skill_error",
        "error_code": "app_launch_failed",
        "skill": "app-launcher",
    }
