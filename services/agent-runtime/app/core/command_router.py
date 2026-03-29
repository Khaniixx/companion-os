"""Minimal MVP command router for companion messages."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.chat.service import generate_companion_reply
from app.preferences import get_permission
from app.skills.app_launcher import launch_app_skill
from app.skills.browser_helper import run_browser_helper
from app.skills.micro_utilities import run_micro_utility


RouteName = Literal[
    "companion-chat",
    "app-launcher",
    "browser-helper",
    "micro-utilities",
]


@dataclass(frozen=True)
class RouterResult:
    """Structured response returned by the MVP router."""

    ok: bool
    route: RouteName
    user_message: str
    assistant_response: str
    action: dict[str, object] | None = None


def _normalized_message(message: str) -> tuple[str, str]:
    stripped = message.strip()
    return stripped, stripped.lower()


def _looks_like_browser_target(target: str) -> bool:
    normalized_target = target.strip().lower()
    if not normalized_target or " " in normalized_target:
        return False

    if normalized_target.startswith(("http://", "https://")):
        return True

    return "." in normalized_target


def _looks_like_micro_utility_request(message: str) -> bool:
    lowered_message = message.strip().lower()
    utility_prefixes = (
        "set a ",
        "set an ",
        "set timer",
        "start timer",
        "start a ",
        "alarm ",
        "set alarm",
        "remind me to ",
        "add todo ",
        "add to-do ",
        "create todo ",
        "show timers",
        "show alarms",
        "show reminders",
        "show my todo",
        "show todo",
        "show to-do",
        "show todos",
        "show to-dos",
        "list timers",
        "list alarms",
        "list reminders",
        "list todos",
        "list to-dos",
        "save clipboard",
        "capture clipboard",
        "remember clipboard",
        "show clipboard",
        "show shortcuts",
        "list shortcuts",
        "run shortcut ",
        "launch shortcut ",
        "open shortcut ",
    )
    return lowered_message.startswith(utility_prefixes)


def choose_route(message: str) -> RouteName:
    """Choose an MVP route for the incoming user message."""

    normalized_message, lowered_message = _normalized_message(message)

    if lowered_message in {"open spotify", "open discord"}:
        return "app-launcher"

    if lowered_message.startswith("search for "):
        return "browser-helper"

    if lowered_message.startswith("open "):
        target = normalized_message[5:].strip()
        if _looks_like_browser_target(target):
            return "browser-helper"

    if _looks_like_micro_utility_request(normalized_message):
        return "micro-utilities"

    return "companion-chat"


def route_user_message(message: str) -> RouterResult:
    """Route a user message into a simple MVP action or local chat reply."""

    normalized_message, lowered_message = _normalized_message(message)
    route = choose_route(normalized_message)

    if route == "app-launcher":
        app_name = lowered_message[5:].strip()
        if not get_permission("open_app"):
            return RouterResult(
                ok=False,
                route="app-launcher",
                user_message=normalized_message,
                assistant_response=(
                    f"I can open {app_name.title()} once you allow app launches in Companion OS."
                ),
                action={
                    "type": "permission_required",
                    "permission": "open_app",
                    "target": app_name,
                },
            )

        result = launch_app_skill(app_name)
        return RouterResult(
            ok=result["ok"],
            route="app-launcher",
            user_message=normalized_message,
            assistant_response=(
                f"I am opening {app_name.title()} for you."
                if result["ok"]
                else result["message"]
            ),
            action={
                "type": "open_app",
                "app": result["app"],
            },
        )

    if route == "browser-helper":
        if not get_permission("open_url"):
            return RouterResult(
                ok=False,
                route="browser-helper",
                user_message=normalized_message,
                assistant_response=(
                    "I can use the browser once you allow browser access in Companion OS."
                ),
                action={
                    "type": "permission_required",
                    "permission": "open_url",
                },
            )

        result = run_browser_helper(normalized_message)
        return RouterResult(
            ok=result["ok"],
            route="browser-helper",
            user_message=normalized_message,
            assistant_response=result["message"],
            action={
                "type": result["action"],
                "url": result["url"],
            },
        )

    if route == "micro-utilities":
        try:
            result = run_micro_utility(normalized_message)
        except ValueError:
            reply = generate_companion_reply(normalized_message)
            return RouterResult(
                ok=reply.ok,
                route="companion-chat",
                user_message=normalized_message,
                assistant_response=reply.message,
                action={
                    "type": "chat_reply",
                    "provider": reply.provider,
                    "model": reply.model,
                    "fallback_from": "micro-utilities",
                },
            )

        return RouterResult(
            ok=result["ok"],
            route="micro-utilities",
            user_message=normalized_message,
            assistant_response=result["message"],
            action={
                "type": result["action"],
                **result["metadata"],
            },
        )

    reply = generate_companion_reply(normalized_message)
    return RouterResult(
        ok=reply.ok,
        route="companion-chat",
        user_message=normalized_message,
        assistant_response=reply.message,
        action={
            "type": "chat_reply",
            "provider": reply.provider,
            "model": reply.model,
        },
    )
