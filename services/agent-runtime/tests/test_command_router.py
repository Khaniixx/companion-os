from pathlib import Path

import app.preferences as preferences
from app.core.command_router import choose_route, route_user_message


def test_choose_route_for_supported_app_commands() -> None:
    assert choose_route("open Spotify") == "app-launcher"
    assert choose_route("  Open discord  ") == "app-launcher"


def test_choose_route_for_browser_queries() -> None:
    assert choose_route("search for local companion setup") == "browser-helper"
    assert choose_route("open openai.com") == "browser-helper"


def test_choose_route_falls_back_to_companion_chat() -> None:
    assert choose_route("open spreadsheet") == "companion-chat"
    assert choose_route("how are you today?") == "companion-chat"


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
    }
