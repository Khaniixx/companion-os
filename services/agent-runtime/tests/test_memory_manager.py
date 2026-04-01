from pathlib import Path

import pytest

import app.memory_manager as memory_manager
import app.preferences as preferences


@pytest.fixture(autouse=True)
def temp_memory_state(tmp_path, monkeypatch) -> Path:
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", tmp_path / "preferences.json")
    monkeypatch.setattr(memory_manager, "MEMORY_STATE_FILE", tmp_path / "memory_state.json")
    return tmp_path


def test_record_chat_turn_creates_summary_when_threshold_is_reached() -> None:
    preferences.update_memory_settings(summary_frequency_messages=2)

    created_summary = memory_manager.record_chat_turn(
        "remember this question",
        "I will keep the local context in mind.",
    )

    assert created_summary is not None
    assert created_summary["message_count"] == 2
    assert created_summary["title"] == "Recent: remember this question"
    assert "remember this question" in created_summary["summary"]

    state = memory_manager.list_memory_state()
    assert state["pending_message_count"] == 0
    assert state["shared_pending_message_count"] == 0
    assert len(state["summaries"]) == 1
    assert len(state["shared_summaries"]) == 1
    assert state["pack_summaries"] == []
    assert state["pack_pending_message_count"] == 0


def test_disabling_long_term_memory_skips_new_summaries() -> None:
    preferences.update_memory_settings(
        long_term_memory_enabled=False,
        summary_frequency_messages=2,
    )

    created_summary = memory_manager.record_chat_turn(
        "do not store this",
        "I will keep it in the live session only.",
    )

    assert created_summary is None
    state = memory_manager.list_memory_state()
    assert state["pending_message_count"] == 0
    assert state["shared_pending_message_count"] == 0
    assert state["summaries"] == []
    assert state["shared_summaries"] == []
    assert state["pack_summaries"] == []
    assert state["pack_pending_message_count"] == 0


def test_update_and_delete_memory_summary() -> None:
    preferences.update_memory_settings(summary_frequency_messages=2)
    created_summary = memory_manager.record_chat_turn(
        "capture this topic",
        "Captured locally.",
    )
    assert created_summary is not None

    updated_summary = memory_manager.update_memory_summary(
        created_summary["id"],
        title="Edited memory",
        summary="A shorter summary kept on this device.",
    )
    assert updated_summary["title"] == "Edited memory"
    assert updated_summary["summary"] == "A shorter summary kept on this device."

    deleted_summary_id = memory_manager.delete_memory_summary(created_summary["id"])
    assert deleted_summary_id == created_summary["id"]
    assert memory_manager.list_memory_state()["summaries"] == []


def test_clear_memory_summaries_resets_summaries_and_pending_messages() -> None:
    preferences.update_memory_settings(summary_frequency_messages=4)
    memory_manager.record_chat_turn("first topic", "first reply")
    deleted_count = memory_manager.clear_memory_summaries()

    assert deleted_count == 0
    state = memory_manager.list_memory_state()
    assert state["pending_message_count"] == 0
    assert state["summaries"] == []


def test_record_chat_turn_creates_pack_specific_thread_for_active_pack() -> None:
    preferences.update_memory_settings(summary_frequency_messages=2)
    preferences.set_active_pack_id("sunrise-companion")

    created_summary = memory_manager.record_chat_turn(
        "keep the Sunrise thread warm",
        "Sunrise keeps the desk calm and focused.",
    )

    assert created_summary is not None
    shared_state = memory_manager.list_memory_state(active_pack_id="sunrise-companion")
    assert shared_state["active_pack_id"] == "sunrise-companion"
    assert len(shared_state["shared_summaries"]) == 1
    assert len(shared_state["pack_summaries"]) == 1
    assert shared_state["pack_summaries"][0]["pack_id"] == "sunrise-companion"
    assert shared_state["pack_summaries"][0]["thread"] == "pack"
    assert (
        "keep the Sunrise thread warm"
        in shared_state["pack_summaries"][0]["summary"]
    )
