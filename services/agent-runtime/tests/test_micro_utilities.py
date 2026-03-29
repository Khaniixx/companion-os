import pytest

import app.micro_utilities as micro_utilities
import app.preferences as preferences
from app.skills.micro_utilities import run_micro_utility


@pytest.fixture(autouse=True)
def temp_micro_utility_state(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        micro_utilities,
        "MICRO_UTILITIES_FILE",
        tmp_path / "micro_utilities.json",
    )
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", tmp_path / "preferences.json")


def test_run_micro_utility_creates_reminder() -> None:
    result = run_micro_utility("remind me to stretch in 15 minutes")

    assert result["ok"] is True
    assert result["action"] == "created_reminder"
    assert result["metadata"]["utility"]["label"] == "stretch"

    state = micro_utilities.list_micro_utility_state()
    assert state["reminders"][0]["label"] == "stretch"


def test_run_micro_utility_adds_todo() -> None:
    result = run_micro_utility("add todo buy oat milk")

    assert result["ok"] is True
    assert result["action"] == "created_todo"
    assert 'buy oat milk' in result["message"]

    state = micro_utilities.list_micro_utility_state()
    assert state["todos"][0]["label"] == "buy oat milk"


def test_run_micro_utility_parses_suffix_todo_form() -> None:
    result = run_micro_utility("add buy oat milk to my todo list")

    assert result["ok"] is True
    assert result["action"] == "created_todo"
    assert 'buy oat milk' in result["message"]


def test_run_micro_utility_parses_shortcut_without_regex() -> None:
    result = run_micro_utility("run shortcut local-setup")

    assert result["ok"] is False
    assert result["action"] == "permission_required"
    assert result["metadata"]["permission"] == "open_url"


def test_execute_browser_shortcut_requires_permission() -> None:
    result = run_micro_utility("run shortcut local-setup")

    assert result["ok"] is False
    assert result["action"] == "permission_required"
    assert result["metadata"]["permission"] == "open_url"


def test_capture_clipboard_entry_limits_history() -> None:
    for index in range(12):
        micro_utilities.capture_clipboard_entry(f"entry {index}")

    state = micro_utilities.list_micro_utility_state()

    assert len(state["clipboard_history"]) == 10
    assert state["clipboard_history"][0]["text"] == "entry 11"
    assert state["clipboard_history"][-1]["text"] == "entry 2"
