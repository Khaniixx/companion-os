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
REMINDER_IN_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^remind\s+me\s+to\s+(?P<text>.+?)\s+in\s+(?P<amount>\d+)\s*(?P<unit>minute|minutes|min|hour|hours)$",
    re.IGNORECASE,
)
REMINDER_AT_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^remind\s+me\s+to\s+(?P<text>.+?)\s+(?:at|for)\s+(?P<time>\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$",
    re.IGNORECASE,
)
TODO_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?:add|create)\s+(?P<text>.+?)\s+(?:to|on)\s+(?:my\s+)?(?:to-do|todo)\s+list$",
    re.IGNORECASE,
)
TODO_ALT_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?:add|create)\s+(?:a\s+)?(?:to-do|todo)\s+(?P<text>.+)$",
    re.IGNORECASE,
)
SHORTCUT_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(?:run|launch|open)\s+shortcut\s+(?P<shortcut_id>.+)$",
    re.IGNORECASE,
)


def _duration_to_minutes(amount: int, unit: str) -> int:
    normalized_unit = unit.lower()
    if normalized_unit in {"minute", "minutes", "min"}:
        return amount
    return amount * 60


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

    reminder_match = REMINDER_IN_PATTERN.match(normalized_request)
    if reminder_match is not None:
        duration_minutes = _duration_to_minutes(
            int(reminder_match.group("amount")),
            reminder_match.group("unit"),
        )
        reminder = create_reminder(
            text=reminder_match.group("text"),
            due_at=datetime.now(UTC) + timedelta(minutes=duration_minutes),
        )
        return {
            "ok": True,
            "action": "created_reminder",
            "request": normalized_request,
            "message": f'I will remind you to {reminder["label"]} in {duration_minutes} minutes.',
            "metadata": {"utility": reminder},
        }

    reminder_at_match = REMINDER_AT_PATTERN.match(normalized_request)
    if reminder_at_match is not None:
        due_at = _parse_clock_time(reminder_at_match.group("time"))
        reminder = create_reminder(
            text=reminder_at_match.group("text"),
            due_at=due_at,
        )
        return {
            "ok": True,
            "action": "created_reminder",
            "request": normalized_request,
            "message": f'I will remind you to {reminder["label"]} at {reminder_at_match.group("time").strip()}.',
            "metadata": {"utility": reminder},
        }

    todo_match = TODO_PATTERN.match(normalized_request) or TODO_ALT_PATTERN.match(
        normalized_request
    )
    if todo_match is not None:
        todo = add_todo(text=todo_match.group("text"))
        return {
            "ok": True,
            "action": "created_todo",
            "request": normalized_request,
            "message": f'I added "{todo["label"]}" to your local to-do list.',
            "metadata": {"utility": todo},
        }

    shortcut_match = SHORTCUT_PATTERN.match(normalized_request)
    if shortcut_match is not None:
        result = execute_shortcut(shortcut_match.group("shortcut_id"))
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
