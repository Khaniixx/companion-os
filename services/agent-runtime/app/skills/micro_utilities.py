"""Skill parser for timers, reminders, to-dos, clipboard history, and shortcuts."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Final, Literal, TypedDict

from app.micro_utilities import (
    add_todo,
    create_alarm,
    create_reminder,
    create_timer,
    describe_active_timers,
    describe_clipboard_history,
    describe_reminders,
    describe_shortcuts,
    describe_todos,
    execute_shortcut,
)


MicroUtilityAction = Literal[
    "created_timer",
    "created_alarm",
    "created_reminder",
    "created_todo",
    "listed_utilities",
    "capture_clipboard",
    "shortcut_executed",
    "permission_required",
]


class MicroUtilityResult(TypedDict):
    ok: bool
    action: MicroUtilityAction
    request: str
    message: str
    metadata: dict[str, object]


TIMER_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?:set|start)\s+(?:a\s+)?(?P<amount>\d+)\s*[- ]?(?P<unit>minute|minutes|min|hour|hours)\s+timer$",
    re.IGNORECASE,
)
TIMER_FOR_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?:set|start)\s+(?:a\s+)?timer\s+for\s+(?P<amount>\d+)\s*[- ]?(?P<unit>minute|minutes|min|hour|hours)$",
    re.IGNORECASE,
)
ALARM_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?:set\s+)?(?:an?\s+)?alarm(?:\s+for|\s+at)?\s+(?P<time>\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$",
    re.IGNORECASE,
)
def _duration_to_minutes(amount: int, unit: str) -> int:
    normalized_unit = unit.lower()
    if normalized_unit in {"minute", "minutes", "min"}:
        return amount
    return amount * 60


def _parse_duration_phrase(raw_value: str) -> tuple[int, str]:
    parts = raw_value.strip().split()
    if len(parts) != 2 or not parts[0].isdigit():
        raise ValueError("Time duration must look like 15 minutes or 1 hour.")

    unit = parts[1].lower()
    if unit not in {"minute", "minutes", "min", "hour", "hours"}:
        raise ValueError("Time duration must use minutes or hours.")

    return int(parts[0]), unit


def _parse_clock_time(raw_time: str) -> datetime:
    normalized = raw_time.strip().lower()
    now = datetime.now(UTC)

    matched_time = re.match(
        r"^(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>am|pm)?$",
        normalized,
    )
    if matched_time is None:
        raise ValueError("Time must look like 7:30 or 7:30 pm.")

    hour = int(matched_time.group("hour"))
    minute = int(matched_time.group("minute") or "0")
    ampm = matched_time.group("ampm")

    if ampm is not None:
        if hour < 1 or hour > 12:
            raise ValueError("Hour must be between 1 and 12 when am/pm is used.")
        if ampm == "pm" and hour != 12:
            hour += 12
        if ampm == "am" and hour == 12:
            hour = 0
    elif hour > 23:
        raise ValueError("Hour must be between 0 and 23.")

    due_at = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if due_at <= now:
        due_at += timedelta(days=1)
    return due_at


def _list_request_response(request_text: str) -> MicroUtilityResult | None:
    lowered_request = request_text.lower()

    if lowered_request in {"show timers", "show alarms", "list timers", "list alarms"}:
        return {
            "ok": True,
            "action": "listed_utilities",
            "request": request_text,
            "message": describe_active_timers(),
            "metadata": {"utility": "timers"},
        }

    if lowered_request in {"show reminders", "list reminders"}:
        return {
            "ok": True,
            "action": "listed_utilities",
            "request": request_text,
            "message": describe_reminders(),
            "metadata": {"utility": "reminders"},
        }

    if lowered_request in {
        "show my todo list",
        "show my to-do list",
        "show todo list",
        "show to-do list",
        "list todos",
        "list to-dos",
        "show todos",
        "show to-dos",
    }:
        return {
            "ok": True,
            "action": "listed_utilities",
            "request": request_text,
            "message": describe_todos(),
            "metadata": {"utility": "todos"},
        }

    if lowered_request in {
        "show clipboard history",
        "list clipboard history",
        "show clipboard",
    }:
        return {
            "ok": True,
            "action": "listed_utilities",
            "request": request_text,
            "message": describe_clipboard_history(),
            "metadata": {"utility": "clipboard_history"},
        }

    if lowered_request in {"show shortcuts", "list shortcuts"}:
        return {
            "ok": True,
            "action": "listed_utilities",
            "request": request_text,
            "message": describe_shortcuts(),
            "metadata": {"utility": "shortcuts"},
        }

    return None


def _parse_reminder_in_request(request_text: str) -> tuple[str, int, str] | None:
    prefix = "remind me to "
    lowered_request = request_text.lower()
    if not lowered_request.startswith(prefix):
        return None

    reminder_body = request_text[len(prefix) :].strip()
    split_index = reminder_body.lower().rfind(" in ")
    if split_index <= 0:
        return None

    reminder_text = reminder_body[:split_index].strip()
    amount, unit = _parse_duration_phrase(reminder_body[split_index + 4 :])
    if not reminder_text:
        raise ValueError("Reminder text cannot be empty.")

    return reminder_text, amount, unit


def _parse_reminder_at_request(request_text: str) -> tuple[str, str] | None:
    prefix = "remind me to "
    lowered_request = request_text.lower()
    if not lowered_request.startswith(prefix):
        return None

    reminder_body = request_text[len(prefix) :].strip()
    for separator in (" at ", " for "):
        split_index = reminder_body.lower().rfind(separator)
        if split_index <= 0:
            continue

        reminder_text = reminder_body[:split_index].strip()
        raw_time = reminder_body[split_index + len(separator) :].strip()
        if not reminder_text:
            raise ValueError("Reminder text cannot be empty.")
        if not raw_time:
            raise ValueError("Reminder time cannot be empty.")
        return reminder_text, raw_time

    return None


def _parse_todo_request(request_text: str) -> str | None:
    lowered_request = request_text.lower()

    for prefix in ("add todo ", "add to-do ", "create todo ", "create to-do "):
        if lowered_request.startswith(prefix):
            todo_text = request_text[len(prefix) :].strip()
            if not todo_text:
                raise ValueError("To-do text cannot be empty.")
            return todo_text

    for prefix in ("add a todo ", "add a to-do ", "create a todo ", "create a to-do "):
        if lowered_request.startswith(prefix):
            todo_text = request_text[len(prefix) :].strip()
            if not todo_text:
                raise ValueError("To-do text cannot be empty.")
            return todo_text

    for action_prefix in ("add ", "create "):
        if not lowered_request.startswith(action_prefix):
            continue

        todo_body = request_text[len(action_prefix) :].strip()
        lowered_body = todo_body.lower()
        for suffix in (" to my todo list", " to my to-do list", " on my todo list", " on my to-do list"):
            if lowered_body.endswith(suffix):
                todo_text = todo_body[: -len(suffix)].strip()
                if not todo_text:
                    raise ValueError("To-do text cannot be empty.")
                return todo_text

        for suffix in (" to todo list", " to to-do list", " on todo list", " on to-do list"):
            if lowered_body.endswith(suffix):
                todo_text = todo_body[: -len(suffix)].strip()
                if not todo_text:
                    raise ValueError("To-do text cannot be empty.")
                return todo_text

    return None


def _parse_shortcut_request(request_text: str) -> str | None:
    lowered_request = request_text.lower()
    for prefix in ("run shortcut ", "launch shortcut ", "open shortcut "):
        if lowered_request.startswith(prefix):
            shortcut_id = request_text[len(prefix) :].strip()
            if not shortcut_id:
                raise ValueError("Shortcut name cannot be empty.")
            return shortcut_id
    return None


def run_micro_utility(request_text: str) -> MicroUtilityResult:
    """Parse a utility request and run the relevant local action."""

    normalized_request = request_text.strip()
    lowered_request = normalized_request.lower()

    list_response = _list_request_response(normalized_request)
    if list_response is not None:
        return list_response

    if lowered_request in {"save clipboard", "capture clipboard", "remember clipboard"}:
        return {
            "ok": True,
            "action": "capture_clipboard",
            "request": normalized_request,
            "message": "I am ready to save the current clipboard text into local history.",
            "metadata": {"utility": "clipboard"},
        }

    timer_match = TIMER_PATTERN.match(normalized_request) or TIMER_FOR_PATTERN.match(
        normalized_request
    )
    if timer_match is not None:
        duration_minutes = _duration_to_minutes(
            int(timer_match.group("amount")),
            timer_match.group("unit"),
        )
        timer = create_timer(duration_minutes=duration_minutes)
        return {
            "ok": True,
            "action": "created_timer",
            "request": normalized_request,
            "message": f'I set a {timer["label"]}. I will keep it subtle and local.',
            "metadata": {"utility": timer},
        }

    alarm_match = ALARM_PATTERN.match(normalized_request)
    if alarm_match is not None:
        due_at = _parse_clock_time(alarm_match.group("time"))
        alarm = create_alarm(label="Alarm", due_at=due_at)
        return {
            "ok": True,
            "action": "created_alarm",
            "request": normalized_request,
            "message": f'I set an alarm for {alarm_match.group("time").strip()}.',
            "metadata": {"utility": alarm},
        }

    reminder_in = _parse_reminder_in_request(normalized_request)
    if reminder_in is not None:
        reminder_text, amount, unit = reminder_in
        duration_minutes = _duration_to_minutes(
            amount,
            unit,
        )
        reminder = create_reminder(
            text=reminder_text,
            due_at=datetime.now(UTC) + timedelta(minutes=duration_minutes),
        )
        return {
            "ok": True,
            "action": "created_reminder",
            "request": normalized_request,
            "message": f'I will remind you to {reminder["label"]} in {duration_minutes} minutes.',
            "metadata": {"utility": reminder},
        }

    reminder_at = _parse_reminder_at_request(normalized_request)
    if reminder_at is not None:
        reminder_text, raw_time = reminder_at
        due_at = _parse_clock_time(raw_time)
        reminder = create_reminder(
            text=reminder_text,
            due_at=due_at,
        )
        return {
            "ok": True,
            "action": "created_reminder",
            "request": normalized_request,
            "message": f'I will remind you to {reminder["label"]} at {raw_time}.',
            "metadata": {"utility": reminder},
        }

    todo_text = _parse_todo_request(normalized_request)
    if todo_text is not None:
        todo = add_todo(text=todo_text)
        return {
            "ok": True,
            "action": "created_todo",
            "request": normalized_request,
            "message": f'I added "{todo["label"]}" to your local to-do list.',
            "metadata": {"utility": todo},
        }

    shortcut_id = _parse_shortcut_request(normalized_request)
    if shortcut_id is not None:
        result = execute_shortcut(shortcut_id)
        action = result.get("action", {})
        return {
            "ok": bool(result["ok"]),
            "action": action.get("type", "shortcut_executed"),  # type: ignore[arg-type]
            "request": normalized_request,
            "message": str(result["message"]),
            "metadata": action if isinstance(action, dict) else {},
        }

    raise ValueError(
        "Unsupported utility request. Try a timer, reminder, to-do, clipboard save, or shortcut."
    )
