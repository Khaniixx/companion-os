from datetime import UTC, datetime

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


def test_timers_persist_and_fire_after_restart(monkeypatch) -> None:
    start_time = datetime(2026, 3, 29, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(micro_utilities, "_now", lambda: start_time)

    timer = micro_utilities.create_timer(duration_minutes=5)
    initial_state = micro_utilities.list_micro_utility_state()

    assert initial_state["timers"][0]["id"] == timer["id"]
    assert initial_state["alerts"] == []

    monkeypatch.setattr(
        micro_utilities,
        "_now",
        lambda: datetime(2026, 3, 29, 0, 6, tzinfo=UTC),
    )
    resumed_state = micro_utilities.list_micro_utility_state()

    assert resumed_state["timers"][0]["fired_at"] is not None
    assert resumed_state["alerts"][0]["id"] == timer["id"]


def test_dismiss_utility_alert_marks_timer_complete(monkeypatch) -> None:
    monkeypatch.setattr(
        micro_utilities,
        "_now",
        lambda: datetime(2026, 3, 29, 0, 0, tzinfo=UTC),
    )
    timer = micro_utilities.create_timer(duration_minutes=1)
    monkeypatch.setattr(
        micro_utilities,
        "_now",
        lambda: datetime(2026, 3, 29, 0, 2, tzinfo=UTC),
    )

    state = micro_utilities.list_micro_utility_state()
    assert state["alerts"][0]["id"] == timer["id"]

    dismissed = micro_utilities.dismiss_utility_alert(timer["id"])
    refreshed_state = micro_utilities.list_micro_utility_state()

    assert dismissed["dismissed"] is True
    assert dismissed["completed"] is True
    assert refreshed_state["alerts"] == []


def test_notes_are_combined_and_editable() -> None:
    reminder_result = run_micro_utility("remind me to stretch in 15 minutes")
    todo_result = run_micro_utility("add todo buy oat milk")

    reminder_id = reminder_result["metadata"]["utility"]["id"]
    todo_id = todo_result["metadata"]["utility"]["id"]

    updated_reminder = micro_utilities.update_note(reminder_id, label="stretch gently")
    updated_todo = micro_utilities.update_note(todo_id, completed=True)
    state = micro_utilities.list_micro_utility_state()

    assert updated_reminder["label"] == "stretch gently"
    assert updated_todo["completed"] is True
    assert {item["id"] for item in state["notes"]} == {reminder_id, todo_id}


def test_capture_clipboard_entry_deduplicates_rapid_repeats() -> None:
    first_entry = micro_utilities.capture_clipboard_entry("same value")
    second_entry = micro_utilities.capture_clipboard_entry("same value")
    state = micro_utilities.list_micro_utility_state()

    assert first_entry["id"] == second_entry["id"]
    assert len(state["clipboard_history"]) == 1
    assert state["clipboard_history"][0]["text"] == "same value"
