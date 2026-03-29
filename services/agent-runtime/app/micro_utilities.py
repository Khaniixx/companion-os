"""Local micro-utility storage and helpers for Companion OS."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Final, Literal, TypedDict

from app.preferences import get_permission
from app.skills.app_launcher import launch_app_skill
from app.skills.browser_helper import run_browser_helper


MICRO_UTILITIES_FILE = (
    Path(__file__).resolve().parents[1] / "data" / "micro_utilities.json"
)
MAX_CLIPBOARD_HISTORY: Final[int] = 10
ShortcutKind = Literal["app", "browser"]
UtilityKind = Literal["timer", "alarm", "reminder", "todo"]
CollectionName = Literal["timers", "reminders", "todos"]

_micro_utilities_lock = Lock()


class Shortcut(TypedDict):
    id: str
    label: str
    kind: ShortcutKind
    target: str


class ScheduledUtility(TypedDict):
    id: int
    kind: UtilityKind
    label: str
    due_at: str | None
    completed: bool
    created_at: str
    updated_at: str
    fired_at: str | None
    dismissed: bool


class ClipboardEntry(TypedDict):
    id: int
    text: str
    created_at: str


class MicroUtilitiesState(TypedDict):
    next_id: int
    timers: list[ScheduledUtility]
    reminders: list[ScheduledUtility]
    todos: list[ScheduledUtility]
    clipboard_history: list[ClipboardEntry]
    shortcuts: list[Shortcut]


DEFAULT_SHORTCUTS: Final[list[Shortcut]] = [
    {"id": "spotify", "label": "Spotify", "kind": "app", "target": "spotify"},
    {"id": "discord", "label": "Discord", "kind": "app", "target": "discord"},
    {
        "id": "local-setup",
        "label": "Local Setup Search",
        "kind": "browser",
        "target": "search for Companion OS local setup",
    },
]


def _now() -> datetime:
    return datetime.now(UTC)


def _now_iso() -> str:
    return _now().isoformat()


def _default_state() -> MicroUtilitiesState:
    return {
        "next_id": 1,
        "timers": [],
        "reminders": [],
        "todos": [],
        "clipboard_history": [],
        "shortcuts": [shortcut.copy() for shortcut in DEFAULT_SHORTCUTS],
    }


def _ensure_state_file() -> None:
    if MICRO_UTILITIES_FILE.exists():
        return

    MICRO_UTILITIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    _write_state(_default_state())


def _normalize_shortcuts(raw_shortcuts: object) -> list[Shortcut]:
    if not isinstance(raw_shortcuts, list):
        return [shortcut.copy() for shortcut in DEFAULT_SHORTCUTS]

    shortcuts: list[Shortcut] = []
    for item in raw_shortcuts:
        if not isinstance(item, dict):
            continue
        shortcut_id = str(item.get("id", "")).strip().lower()
        label = str(item.get("label", "")).strip()
        kind = str(item.get("kind", "")).strip().lower()
        target = str(item.get("target", "")).strip()
        if shortcut_id and label and kind in {"app", "browser"} and target:
            shortcuts.append(
                {
                    "id": shortcut_id,
                    "label": label,
                    "kind": kind,  # type: ignore[typeddict-item]
                    "target": target,
                }
            )

    if shortcuts:
        return shortcuts
    return [shortcut.copy() for shortcut in DEFAULT_SHORTCUTS]


def _normalize_scheduled_utilities(
    raw_utilities: object,
    *,
    expected_kind: UtilityKind,
) -> list[ScheduledUtility]:
    if not isinstance(raw_utilities, list):
        return []

    utilities: list[ScheduledUtility] = []
    for item in raw_utilities:
        if not isinstance(item, dict):
            continue

        utility_id = item.get("id")
        label = item.get("label")
        due_at = item.get("due_at")
        completed = item.get("completed", False)
        created_at = item.get("created_at")
        updated_at = item.get("updated_at")
        fired_at = item.get("fired_at")
        dismissed = item.get("dismissed", False)
        if not isinstance(utility_id, int) or not isinstance(label, str):
            continue

        raw_kind = str(item.get("kind", expected_kind)).strip().lower()
        normalized_kind = expected_kind
        if expected_kind == "timer" and raw_kind == "alarm":
            normalized_kind = "alarm"

        utilities.append(
            {
                "id": utility_id,
                "kind": normalized_kind,
                "label": label.strip(),
                "due_at": str(due_at) if due_at is not None else None,
                "completed": bool(completed),
                "created_at": str(created_at or _now_iso()),
                "updated_at": str(updated_at or created_at or _now_iso()),
                "fired_at": str(fired_at) if fired_at is not None else None,
                "dismissed": bool(dismissed),
            }
        )

    return utilities


def _normalize_clipboard_history(raw_history: object) -> list[ClipboardEntry]:
    if not isinstance(raw_history, list):
        return []

    history: list[ClipboardEntry] = []
    for item in raw_history:
        if not isinstance(item, dict):
            continue
        entry_id = item.get("id")
        text = item.get("text")
        created_at = item.get("created_at")
        if not isinstance(entry_id, int) or not isinstance(text, str):
            continue
        history.append(
            {
                "id": entry_id,
                "text": text.strip(),
                "created_at": str(created_at or _now_iso()),
            }
        )

    return history[:MAX_CLIPBOARD_HISTORY]


def _parse_iso_datetime(raw_value: str | None) -> datetime | None:
    if raw_value is None:
        return None

    try:
        parsed_value = datetime.fromisoformat(raw_value)
    except ValueError:
        return None

    if parsed_value.tzinfo is None:
        return parsed_value.replace(tzinfo=UTC)
    return parsed_value.astimezone(UTC)


def _refresh_due_utilities(state: MicroUtilitiesState) -> bool:
    now = _now()
    changed = False
    for utility in state["timers"]:
        due_at = _parse_iso_datetime(utility["due_at"])
        if due_at is None:
            continue
        if utility["completed"] or utility["dismissed"] or utility["fired_at"] is not None:
            continue
        if due_at <= now:
            utility["fired_at"] = now.isoformat()
            utility["updated_at"] = now.isoformat()
            changed = True
    return changed


def _read_state() -> MicroUtilitiesState:
    _ensure_state_file()
    try:
        raw_state = json.loads(MICRO_UTILITIES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _default_state()

    if not isinstance(raw_state, dict):
        return _default_state()

    next_id = raw_state.get("next_id", 1)
    if not isinstance(next_id, int) or next_id < 1:
        next_id = 1

    state = {
        "next_id": next_id,
        "timers": _normalize_scheduled_utilities(
            raw_state.get("timers"),
            expected_kind="timer",
        ),
        "reminders": _normalize_scheduled_utilities(
            raw_state.get("reminders"),
            expected_kind="reminder",
        ),
        "todos": _normalize_scheduled_utilities(
            raw_state.get("todos"),
            expected_kind="todo",
        ),
        "clipboard_history": _normalize_clipboard_history(
            raw_state.get("clipboard_history")
        ),
        "shortcuts": _normalize_shortcuts(raw_state.get("shortcuts")),
    }
    if _refresh_due_utilities(state):
        _write_state(state)
    return state


def _write_state(state: MicroUtilitiesState) -> None:
    MICRO_UTILITIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = MICRO_UTILITIES_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps(state, indent=2), encoding="utf-8")
    temp_file.replace(MICRO_UTILITIES_FILE)


def _format_due_time(iso_value: str | None) -> str:
    if iso_value is None:
        return "without a due time"

    due_at = _parse_iso_datetime(iso_value)
    if due_at is None:
        return "soon"

    return due_at.astimezone(UTC).strftime("%H:%M UTC")


def _copy_utility(utility: ScheduledUtility) -> ScheduledUtility:
    return {
        "id": utility["id"],
        "kind": utility["kind"],
        "label": utility["label"],
        "due_at": utility["due_at"],
        "completed": utility["completed"],
        "created_at": utility["created_at"],
        "updated_at": utility["updated_at"],
        "fired_at": utility["fired_at"],
        "dismissed": utility["dismissed"],
    }


def _append_utility(
    state: MicroUtilitiesState,
    *,
    collection_name: CollectionName,
    kind: UtilityKind,
    label: str,
    due_at: str | None,
) -> ScheduledUtility:
    timestamp = _now_iso()
    utility = {
        "id": state["next_id"],
        "kind": kind,
        "label": label.strip(),
        "due_at": due_at,
        "completed": False,
        "created_at": timestamp,
        "updated_at": timestamp,
        "fired_at": None,
        "dismissed": False,
    }
    state["next_id"] += 1
    state[collection_name].insert(0, utility)
    return utility


def _combined_notes(state: MicroUtilitiesState) -> list[ScheduledUtility]:
    notes = [_copy_utility(item) for item in state["reminders"]] + [
        _copy_utility(item) for item in state["todos"]
    ]
    return sorted(notes, key=lambda item: item["created_at"], reverse=True)


def _active_alerts(state: MicroUtilitiesState) -> list[ScheduledUtility]:
    return [
        _copy_utility(item)
        for item in state["timers"]
        if item["fired_at"] is not None and not item["dismissed"] and not item["completed"]
    ]


def list_micro_utility_state() -> dict[str, object]:
    """Return timers, reminders, todos, clipboard history, notes, and alerts."""

    with _micro_utilities_lock:
        state = _read_state()
        return {
            "timers": [_copy_utility(item) for item in state["timers"]],
            "reminders": [_copy_utility(item) for item in state["reminders"]],
            "todos": [_copy_utility(item) for item in state["todos"]],
            "notes": _combined_notes(state),
            "alerts": _active_alerts(state),
            "clipboard_history": [entry.copy() for entry in state["clipboard_history"]],
            "shortcuts": [shortcut.copy() for shortcut in state["shortcuts"]],
        }


def create_timer(*, duration_minutes: int) -> ScheduledUtility:
    """Create a non-intrusive timer."""

    due_at = (_now() + timedelta(minutes=duration_minutes)).isoformat()
    with _micro_utilities_lock:
        state = _read_state()
        timer = _append_utility(
            state,
            collection_name="timers",
            kind="timer",
            label=f"{duration_minutes}-minute timer",
            due_at=due_at,
        )
        _write_state(state)
        return timer


def create_alarm(*, label: str, due_at: datetime) -> ScheduledUtility:
    """Create a non-intrusive alarm."""

    with _micro_utilities_lock:
        state = _read_state()
        alarm = _append_utility(
            state,
            collection_name="timers",
            kind="alarm",
            label=label.strip(),
            due_at=due_at.astimezone(UTC).isoformat(),
        )
        _write_state(state)
        return alarm


def create_reminder(*, text: str, due_at: datetime) -> ScheduledUtility:
    """Create a timed reminder."""

    with _micro_utilities_lock:
        state = _read_state()
        reminder = _append_utility(
            state,
            collection_name="reminders",
            kind="reminder",
            label=text.strip(),
            due_at=due_at.astimezone(UTC).isoformat(),
        )
        _write_state(state)
        return reminder


def add_todo(*, text: str) -> ScheduledUtility:
    """Add a to-do note to the local list."""

    with _micro_utilities_lock:
        state = _read_state()
        todo = _append_utility(
            state,
            collection_name="todos",
            kind="todo",
            label=text.strip(),
            due_at=None,
        )
        _write_state(state)
        return todo


def update_note(
    note_id: int,
    *,
    label: str | None = None,
    completed: bool | None = None,
) -> ScheduledUtility:
    """Edit or complete a reminder or to-do note."""

    with _micro_utilities_lock:
        state = _read_state()
        for collection_name in ("reminders", "todos"):
            for note in state[collection_name]:
                if note["id"] != note_id:
                    continue
                if label is not None:
                    normalized_label = label.strip()
                    if not normalized_label:
                        raise ValueError("Note text cannot be empty.")
                    note["label"] = normalized_label
                if completed is not None:
                    note["completed"] = completed
                note["updated_at"] = _now_iso()
                _write_state(state)
                return _copy_utility(note)

    raise ValueError(f"Note not found: {note_id}")


def toggle_todo(todo_id: int) -> ScheduledUtility:
    """Toggle completion for a stored to-do note."""

    with _micro_utilities_lock:
        state = _read_state()
        for todo in state["todos"]:
            if todo["id"] == todo_id:
                todo["completed"] = not todo["completed"]
                todo["updated_at"] = _now_iso()
                _write_state(state)
                return _copy_utility(todo)

    raise ValueError(f"To-do item not found: {todo_id}")


def dismiss_utility_alert(utility_id: int) -> ScheduledUtility:
    """Dismiss a completed timer or alarm alert."""

    with _micro_utilities_lock:
        state = _read_state()
        for utility in state["timers"]:
            if utility["id"] != utility_id:
                continue
            utility["dismissed"] = True
            utility["completed"] = True
            utility["updated_at"] = _now_iso()
            _write_state(state)
            return _copy_utility(utility)

    raise ValueError(f"Timer or alarm not found: {utility_id}")


def capture_clipboard_entry(text: str) -> ClipboardEntry:
    """Store one clipboard snippet locally."""

    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("Clipboard text must not be empty.")

    with _micro_utilities_lock:
        state = _read_state()
        if state["clipboard_history"] and state["clipboard_history"][0]["text"] == normalized_text:
            state["clipboard_history"][0]["created_at"] = _now_iso()
            _write_state(state)
            return state["clipboard_history"][0].copy()

        entry = {
            "id": state["next_id"],
            "text": normalized_text,
            "created_at": _now_iso(),
        }
        state["next_id"] += 1
        state["clipboard_history"].insert(0, entry)
        state["clipboard_history"] = state["clipboard_history"][:MAX_CLIPBOARD_HISTORY]
        _write_state(state)
        return entry


def execute_shortcut(shortcut_id: str) -> dict[str, object]:
    """Execute a saved shortcut after checking the relevant permission."""

    normalized_shortcut_id = shortcut_id.strip().lower()
    with _micro_utilities_lock:
        state = _read_state()
        shortcut = next(
            (item for item in state["shortcuts"] if item["id"] == normalized_shortcut_id),
            None,
        )

    if shortcut is None:
        raise ValueError(f"Shortcut not found: {normalized_shortcut_id}")

    if shortcut["kind"] == "app":
        if not get_permission("open_app"):
            return {
                "ok": False,
                "message": (
                    f'I can run the "{shortcut["label"]}" shortcut once app launches are allowed.'
                ),
                "action": {
                    "type": "permission_required",
                    "permission": "open_app",
                    "target": shortcut["target"],
                },
            }
        result = launch_app_skill(shortcut["target"])
        if not result["ok"]:
            return {
                "ok": False,
                "message": result["message"],
                "action": {
                    "type": "app_suggestion",
                    "suggestions": result["suggestions"],
                    "reason": result["reason"],
                },
            }
        return {
            "ok": True,
            "message": f'I ran the "{shortcut["label"]}" shortcut.',
            "action": {
                "type": "shortcut_executed",
                "shortcut_id": shortcut["id"],
                "shortcut_kind": shortcut["kind"],
                "target": shortcut["target"],
            },
        }

    if not get_permission("open_url"):
        return {
            "ok": False,
            "message": (
                f'I can run the "{shortcut["label"]}" shortcut once browser access is allowed.'
            ),
            "action": {
                "type": "permission_required",
                "permission": "open_url",
                "target": shortcut["target"],
            },
        }

    result = run_browser_helper(shortcut["target"])
    return {
        "ok": result["ok"],
        "message": f'I ran the "{shortcut["label"]}" shortcut.',
        "action": {
            "type": "shortcut_executed",
            "shortcut_id": shortcut["id"],
            "shortcut_kind": shortcut["kind"],
            "target": result["url"],
        },
    }


def describe_active_timers() -> str:
    """Return a companion-style description of active timers and alarms."""

    state = list_micro_utility_state()
    timers = [
        item
        for item in state["timers"]
        if not bool(item["completed"]) and not bool(item["dismissed"])
    ]
    if not timers:
        return "There are no active timers or alarms right now."

    lines = [
        f'- {item["label"]} due at {_format_due_time(item["due_at"])}'
        for item in timers[:4]
    ]
    return "Here is what is active right now:\n" + "\n".join(lines)


def describe_reminders() -> str:
    """Return a companion-style description of stored reminders."""

    state = list_micro_utility_state()
    reminders = [
        item for item in state["reminders"] if not bool(item["completed"])
    ]
    if not reminders:
        return "There are no active reminders right now."

    lines = [
        f'- {item["label"]} at {_format_due_time(item["due_at"])}'
        for item in reminders[:4]
    ]
    return "Here are your active reminders:\n" + "\n".join(lines)


def describe_todos() -> str:
    """Return a companion-style description of local to-do notes."""

    state = list_micro_utility_state()
    todos = state["todos"]
    if not todos:
        return "Your to-do list is empty right now."

    lines = [
        f'- [{"done" if item["completed"] else "open"}] #{item["id"]} {item["label"]}'
        for item in todos[:6]
    ]
    return "Here is your current to-do list:\n" + "\n".join(lines)


def describe_clipboard_history() -> str:
    """Return a companion-style description of clipboard history."""

    state = list_micro_utility_state()
    entries = state["clipboard_history"]
    if not entries:
        return "Clipboard history is empty right now."

    lines = []
    for entry in entries[:5]:
        snippet = entry["text"].replace("\n", " ").strip()
        if len(snippet) > 80:
            snippet = snippet[:79].rstrip() + "..."
        lines.append(f'- #{entry["id"]} "{snippet}"')
    return "Here is your recent clipboard history:\n" + "\n".join(lines)


def describe_shortcuts() -> str:
    """Return a companion-style description of saved shortcuts."""

    state = list_micro_utility_state()
    shortcuts = state["shortcuts"]
    lines = [f'- {item["label"]} ({item["id"]})' for item in shortcuts]
    return "Here are the quick-launch shortcuts I can run:\n" + "\n".join(lines)
