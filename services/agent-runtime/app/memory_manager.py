"""Local long-term memory summary manager for the companion runtime."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Final, Literal, TypedDict

from app.preferences import get_memory_settings


MEMORY_STATE_FILE = Path(__file__).resolve().parents[1] / "data" / "memory_state.json"
MAX_SUMMARY_TEXT_LENGTH: Final[int] = 900
MAX_SUMMARY_TITLE_LENGTH: Final[int] = 90

_memory_lock = Lock()

MessageSender = Literal["user", "companion"]


class MemoryMessage(TypedDict):
    sender: MessageSender
    text: str
    created_at: str


class MemorySummary(TypedDict):
    id: int
    title: str
    summary: str
    message_count: int
    created_at: str
    updated_at: str
    source: str


class MemoryState(TypedDict):
    next_summary_id: int
    pending_messages: list[MemoryMessage]
    summaries: list[MemorySummary]


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _default_state() -> MemoryState:
    return {
        "next_summary_id": 1,
        "pending_messages": [],
        "summaries": [],
    }


def _ensure_memory_state_file() -> None:
    if MEMORY_STATE_FILE.exists():
        return

    MEMORY_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    MEMORY_STATE_FILE.write_text(json.dumps(_default_state(), indent=2), encoding="utf-8")


def _normalize_state(raw_state: object) -> MemoryState:
    if not isinstance(raw_state, dict):
        return _default_state()

    next_summary_id = raw_state.get("next_summary_id", 1)
    if not isinstance(next_summary_id, int) or next_summary_id < 1:
        next_summary_id = 1

    pending_messages: list[MemoryMessage] = []
    for item in raw_state.get("pending_messages", []):
        if not isinstance(item, dict):
            continue
        sender = item.get("sender")
        text = item.get("text")
        created_at = item.get("created_at")
        if sender not in {"user", "companion"} or not isinstance(text, str):
            continue
        pending_messages.append(
            {
                "sender": sender,
                "text": text.strip(),
                "created_at": str(created_at or _now_iso()),
            }
        )

    summaries: list[MemorySummary] = []
    for item in raw_state.get("summaries", []):
        if not isinstance(item, dict):
            continue
        summary_id = item.get("id")
        title = item.get("title")
        summary = item.get("summary")
        message_count = item.get("message_count")
        if (
            not isinstance(summary_id, int)
            or summary_id < 1
            or not isinstance(title, str)
            or not isinstance(summary, str)
            or not isinstance(message_count, int)
        ):
            continue

        summaries.append(
            {
                "id": summary_id,
                "title": title.strip(),
                "summary": summary.strip(),
                "message_count": message_count,
                "created_at": str(item.get("created_at") or _now_iso()),
                "updated_at": str(item.get("updated_at") or _now_iso()),
                "source": str(item.get("source") or "local"),
            }
        )

    return {
        "next_summary_id": next_summary_id,
        "pending_messages": pending_messages,
        "summaries": summaries,
    }


def _read_state() -> MemoryState:
    _ensure_memory_state_file()
    with MEMORY_STATE_FILE.open("r", encoding="utf-8") as file_handle:
        return _normalize_state(json.load(file_handle))


def _write_state(state: MemoryState) -> None:
    MEMORY_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    MEMORY_STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _trim_text(value: str, *, limit: int) -> str:
    trimmed = value.strip()
    if len(trimmed) <= limit:
        return trimmed
    return trimmed[: limit - 1].rstrip() + "..."


def _summary_title(user_messages: list[str]) -> str:
    if not user_messages:
        return "Recent conversation"
    return _trim_text(f"Recent: {user_messages[0]}", limit=MAX_SUMMARY_TITLE_LENGTH)


def _build_summary_text(messages: list[MemoryMessage]) -> str:
    user_messages = [message["text"] for message in messages if message["sender"] == "user"]
    companion_messages = [
        message["text"] for message in messages if message["sender"] == "companion"
    ]

    sections: list[str] = []
    if user_messages:
        sections.append(
            "The user focused on "
            + "; ".join(_trim_text(message, limit=140) for message in user_messages[:3])
            + "."
        )
    if companion_messages:
        sections.append(
            "The companion responded with "
            + "; ".join(
                _trim_text(message, limit=160) for message in companion_messages[:3]
            )
            + "."
        )
    sections.append(f"This summary covers {len(messages)} recent messages stored locally.")
    return _trim_text(" ".join(sections), limit=MAX_SUMMARY_TEXT_LENGTH)


def _create_summary_from_pending(state: MemoryState) -> MemorySummary | None:
    if not state["pending_messages"]:
        return None

    summary_id = state["next_summary_id"]
    state["next_summary_id"] += 1
    now = _now_iso()
    user_messages = [
        message["text"] for message in state["pending_messages"] if message["sender"] == "user"
    ]
    summary: MemorySummary = {
        "id": summary_id,
        "title": _summary_title(user_messages),
        "summary": _build_summary_text(state["pending_messages"]),
        "message_count": len(state["pending_messages"]),
        "created_at": now,
        "updated_at": now,
        "source": "local",
    }
    state["summaries"].insert(0, summary)
    state["pending_messages"] = []
    return summary


def list_memory_state() -> dict[str, object]:
    """Return stored summaries and the pending unsummarized message count."""

    with _memory_lock:
        state = _read_state()
        return {
            "summaries": state["summaries"],
            "pending_message_count": len(state["pending_messages"]),
        }


def record_chat_turn(user_message: str, assistant_response: str) -> MemorySummary | None:
    """Record a chat turn and summarize locally when the threshold is reached."""

    settings = get_memory_settings()
    if not bool(settings["long_term_memory_enabled"]):
        with _memory_lock:
            state = _read_state()
            if state["pending_messages"]:
                state["pending_messages"] = []
                _write_state(state)
        return None

    with _memory_lock:
        state = _read_state()
        now = _now_iso()
        state["pending_messages"].extend(
            [
                {
                    "sender": "user",
                    "text": user_message.strip(),
                    "created_at": now,
                },
                {
                    "sender": "companion",
                    "text": assistant_response.strip(),
                    "created_at": now,
                },
            ]
        )
        summary_frequency_messages = int(settings["summary_frequency_messages"])
        created_summary = None
        if len(state["pending_messages"]) >= summary_frequency_messages:
            created_summary = _create_summary_from_pending(state)
        _write_state(state)
        return created_summary


def update_memory_summary(
    summary_id: int,
    *,
    title: str | None = None,
    summary: str | None = None,
) -> MemorySummary:
    """Update the title or summary text for one stored memory summary."""

    if title is None and summary is None:
        raise ValueError("At least one memory field must be provided.")

    with _memory_lock:
        state = _read_state()
        for stored_summary in state["summaries"]:
            if stored_summary["id"] != summary_id:
                continue

            if title is not None:
                normalized_title = title.strip()
                if not normalized_title:
                    raise ValueError("title must not be empty")
                stored_summary["title"] = _trim_text(
                    normalized_title,
                    limit=MAX_SUMMARY_TITLE_LENGTH,
                )
            if summary is not None:
                normalized_summary = summary.strip()
                if not normalized_summary:
                    raise ValueError("summary must not be empty")
                stored_summary["summary"] = _trim_text(
                    normalized_summary,
                    limit=MAX_SUMMARY_TEXT_LENGTH,
                )
            stored_summary["updated_at"] = _now_iso()
            _write_state(state)
            return stored_summary

    raise ValueError(f"Memory summary not found: {summary_id}")


def delete_memory_summary(summary_id: int) -> int:
    """Delete a single stored memory summary."""

    with _memory_lock:
        state = _read_state()
        original_count = len(state["summaries"])
        state["summaries"] = [
            summary for summary in state["summaries"] if summary["id"] != summary_id
        ]
        if len(state["summaries"]) == original_count:
            raise ValueError(f"Memory summary not found: {summary_id}")
        _write_state(state)
        return summary_id


def clear_memory_summaries() -> int:
    """Delete all stored summaries and pending local memory messages."""

    with _memory_lock:
        state = _read_state()
        deleted_count = len(state["summaries"])
        state["summaries"] = []
        state["pending_messages"] = []
        _write_state(state)
        return deleted_count


def clear_pending_memory() -> None:
    """Drop unsummarized pending messages without touching saved summaries."""

    with _memory_lock:
        state = _read_state()
        if not state["pending_messages"]:
            return
        state["pending_messages"] = []
        _write_state(state)
