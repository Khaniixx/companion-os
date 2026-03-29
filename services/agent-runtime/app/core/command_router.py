"""Minimal MVP command router for companion messages."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.chat.service import format_in_character_error, generate_companion_reply
from app.preferences import get_permission
from app.skills.app_launcher import has_app_match_hint, launch_app_skill, resolve_app_request
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
    loading: bool = False


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

    if lowered_message.startswith("search for "):
        return "browser-helper"

    if lowered_message.startswith("open "):
        target = normalized_message[5:].strip()
        if _looks_like_browser_target(target):
            return "browser-helper"
        if has_app_match_hint(target):
            return "app-launcher"

    if _looks_like_micro_utility_request(normalized_message):
        return "micro-utilities"

    return "companion-chat"


def route_user_message(message: str) -> RouterResult:
    """Route a user message into a simple MVP action or local chat reply."""

    normalized_message, lowered_message = _normalized_message(message)
    route = choose_route(normalized_message)

    if route == "app-launcher":
        requested_app = normalized_message[5:].strip()
        resolution = resolve_app_request(requested_app)

        if not resolution["ok"]:
            return RouterResult(
                ok=False,
                route="app-launcher",
                user_message=normalized_message,
                assistant_response=resolution["message"],
                action={
                    "type": "app_suggestion",
                    "suggestions": resolution["suggestions"],
                    "reason": resolution["reason"],
                },
            )

        resolved_app = resolution["app"]
        if resolved_app is None:
            return RouterResult(
                ok=False,
                route="app-launcher",
                user_message=normalized_message,
                assistant_response=resolution["message"],
                action={
                    "type": "app_suggestion",
                    "suggestions": resolution["suggestions"],
                    "reason": resolution["reason"],
                },
            )

        if not get_permission("open_app"):
            return RouterResult(
                ok=False,
                route="app-launcher",
                user_message=normalized_message,
                assistant_response=(
                    f'I can open {resolution["display_name"]} as soon as app launches are allowed in Companion OS.'
                ),
                action={
                    "type": "permission_required",
                    "permission": "open_app",
                    "target": resolved_app,
                    "display_name": resolution["display_name"],
                },
            )

        try:
            result = launch_app_skill(requested_app)
            if not result["ok"] or result["app"] is None:
                return RouterResult(
                    ok=False,
                    route="app-launcher",
                    user_message=normalized_message,
                    assistant_response=result["message"],
                    action={
                        "type": "app_suggestion",
                        "suggestions": result["suggestions"],
                        "reason": result["reason"],
                    },
                )
            return RouterResult(
                ok=result["ok"],
                route="app-launcher",
                user_message=normalized_message,
                assistant_response=result["message"],
                action={
                    "type": "open_app",
                    "app": result["app"],
                    "display_name": result["display_name"],
                },
            )
        except (RuntimeError, ValueError):
            return RouterResult(
                ok=False,
                route="app-launcher",
                user_message=normalized_message,
                assistant_response=format_in_character_error("app_launch_failed"),
                action={
                    "type": "skill_error",
                    "error_code": "app_launch_failed",
                    "skill": "app-launcher",
                },
            )

    if route == "browser-helper":
        if not get_permission("open_url"):
            return RouterResult(
                ok=False,
                route="browser-helper",
                user_message=normalized_message,
                assistant_response=(
                    "I can reach for the browser as soon as browser access is allowed in Companion OS."
                ),
                action={
                    "type": "permission_required",
                    "permission": "open_url",
                },
            )

        try:
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
        except (RuntimeError, ValueError):
            return RouterResult(
                ok=False,
                route="browser-helper",
                user_message=normalized_message,
                assistant_response=format_in_character_error("browser_unavailable"),
                action={
                    "type": "skill_error",
                    "error_code": "browser_unavailable",
                    "skill": "browser-helper",
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
                    "error_code": reply.error_code,
                    "display_name": reply.display_name,
                    "fallback_from": "micro-utilities",
                },
                loading=reply.loading,
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
            "error_code": reply.error_code,
            "display_name": reply.display_name,
        },
        loading=reply.loading,
    )
