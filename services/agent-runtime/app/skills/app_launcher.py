"""Skill wrapper for opening supported desktop apps."""

from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Final, Literal, NotRequired, TypedDict, cast

from app.tools.open_app import OpenAppResult, open_app


SupportedAppName = Literal["spotify", "discord"]
APP_LAUNCHER_STATE_FILE = (
    Path(__file__).resolve().parents[1] / "data" / "app_launcher_state.json"
)
SUPPORTED_APP_CATALOG: Final[
    dict[SupportedAppName, dict[str, str | list[str]]]
] = {
    "spotify": {
        "display_name": "Spotify",
        "aliases": ["spotify", "spot", "music"],
    },
    "discord": {
        "display_name": "Discord",
        "aliases": ["discord", "disc", "chat"],
    },
}

_app_launcher_lock = Lock()


class AppResolution(TypedDict):
    """Structured app resolution for router and direct API use."""

    ok: bool
    app: SupportedAppName | None
    display_name: str | None
    message: str
    suggestions: list[str]
    reason: Literal["resolved", "ambiguous", "not_found"]


class AppLaunchSkillResult(TypedDict):
    """Structured app-launcher result."""

    ok: bool
    app: SupportedAppName | None
    display_name: str | None
    message: str
    suggestions: list[str]
    launched: bool
    reason: str
    raw_request: str
    metadata: NotRequired[OpenAppResult]


class AppLauncherState(TypedDict):
    """Persisted recently launched apps for ranking boosts."""

    recent_apps: list[SupportedAppName]


def _default_state() -> AppLauncherState:
    return {"recent_apps": []}


def _read_state() -> AppLauncherState:
    if not APP_LAUNCHER_STATE_FILE.exists():
        return _default_state()

    try:
        raw_state = json.loads(APP_LAUNCHER_STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _default_state()

    if not isinstance(raw_state, dict):
        return _default_state()

    raw_recent = raw_state.get("recent_apps", [])
    if not isinstance(raw_recent, list):
        return _default_state()

    recent_apps = [
        cast(SupportedAppName, str(item).strip().lower())
        for item in raw_recent
        if str(item).strip().lower() in SUPPORTED_APP_CATALOG
    ]
    return {"recent_apps": recent_apps[:5]}


def _write_state(state: AppLauncherState) -> None:
    APP_LAUNCHER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = APP_LAUNCHER_STATE_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps(state, indent=2), encoding="utf-8")
    temp_file.replace(APP_LAUNCHER_STATE_FILE)


def _remember_recent_app(app_name: SupportedAppName) -> None:
    with _app_launcher_lock:
        state = _read_state()
        recent_apps = [item for item in state["recent_apps"] if item != app_name]
        recent_apps.insert(0, app_name)
        _write_state({"recent_apps": recent_apps[:5]})


def _normalize_query(value: str) -> str:
    return "".join(
        character.lower()
        for character in value.strip()
        if character.isalnum() or character in {"+", "#"}
    )


def _levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)

    previous_row = list(range(len(right) + 1))
    for left_index, left_character in enumerate(left, start=1):
        current_row = [left_index]
        for right_index, right_character in enumerate(right, start=1):
            insert_cost = current_row[right_index - 1] + 1
            delete_cost = previous_row[right_index] + 1
            substitute_cost = previous_row[right_index - 1] + (
                0 if left_character == right_character else 1
            )
            current_row.append(min(insert_cost, delete_cost, substitute_cost))
        previous_row = current_row
    return previous_row[-1]


def _candidate_score(
    query: str,
    app_name: SupportedAppName,
    *,
    aliases: list[str],
    recent_apps: list[SupportedAppName],
) -> float:
    normalized_aliases = [_normalize_query(alias) for alias in aliases]
    if query in normalized_aliases:
        score = 0.0
    elif any(alias.startswith(query) for alias in normalized_aliases):
        score = 0.6
    elif any(query in alias for alias in normalized_aliases):
        score = 1.0
    else:
        score = min(_levenshtein_distance(query, alias) for alias in normalized_aliases)

    if app_name in recent_apps:
        score -= 0.35
    return score


def resolve_app_request(app_name: str) -> AppResolution:
    """Resolve a free-form app request into one supported launcher target."""

    normalized_query = _normalize_query(app_name)
    if not normalized_query:
        raise ValueError("App name cannot be empty.")

    with _app_launcher_lock:
        recent_apps = _read_state()["recent_apps"]

    ranked_candidates = sorted(
        (
            (
                _candidate_score(
                    normalized_query,
                    supported_app,
                    aliases=cast(list[str], metadata["aliases"]),
                    recent_apps=recent_apps,
                ),
                supported_app,
                str(metadata["display_name"]),
            )
            for supported_app, metadata in SUPPORTED_APP_CATALOG.items()
        ),
        key=lambda item: (item[0], item[2]),
    )

    top_score, top_app, top_display_name = ranked_candidates[0]
    suggestion_names = [display_name for _, _, display_name in ranked_candidates[:2]]

    if normalized_query in {
        _normalize_query(alias)
        for alias in cast(list[str], SUPPORTED_APP_CATALOG[top_app]["aliases"])
    }:
        return {
            "ok": True,
            "app": top_app,
            "display_name": top_display_name,
            "message": f"I am opening {top_display_name} for you.",
            "suggestions": [top_display_name],
            "reason": "resolved",
        }

    second_score = ranked_candidates[1][0] if len(ranked_candidates) > 1 else 99.0
    if len(normalized_query) <= 2 and second_score <= top_score + 0.8:
        return {
            "ok": False,
            "app": None,
            "display_name": None,
            "message": (
                "I found a couple of close app matches. "
                f"Did you mean {', '.join(suggestion_names)}?"
            ),
            "suggestions": suggestion_names,
            "reason": "ambiguous",
        }

    if top_score <= max(1.5, len(normalized_query) / 2):
        if len(ranked_candidates) > 1 and second_score <= top_score + 0.35:
            return {
                "ok": False,
                "app": None,
                "display_name": None,
                "message": (
                    "I found a couple of close app matches. "
                    f"Did you mean {', '.join(suggestion_names)}?"
                ),
                "suggestions": suggestion_names,
                "reason": "ambiguous",
            }

        return {
            "ok": True,
            "app": top_app,
            "display_name": top_display_name,
            "message": f"I am opening {top_display_name} for you.",
            "suggestions": [top_display_name],
            "reason": "resolved",
        }

    return {
        "ok": False,
        "app": None,
        "display_name": None,
        "message": (
            "I could not find a close app match yet. "
            f"I can open {', '.join(display_name for _, _, display_name in ranked_candidates)}."
        ),
        "suggestions": [display_name for _, _, display_name in ranked_candidates],
        "reason": "not_found",
    }


def has_app_match_hint(app_name: str) -> bool:
    """Return whether a non-URL open request looks like an app-launch request."""

    resolution = resolve_app_request(app_name)
    return resolution["reason"] in {"resolved", "ambiguous"}


def launch_app_skill(app_name: str) -> AppLaunchSkillResult:
    """Launch or suggest an allowed app via the app-launcher skill."""

    resolution = resolve_app_request(app_name)
    if not resolution["ok"] or resolution["app"] is None:
        return {
            "ok": False,
            "app": None,
            "display_name": None,
            "message": resolution["message"],
            "suggestions": resolution["suggestions"],
            "launched": False,
            "reason": resolution["reason"],
            "raw_request": app_name.strip(),
        }

    result = open_app(resolution["app"])
    _remember_recent_app(resolution["app"])
    return {
        "ok": result["ok"],
        "app": resolution["app"],
        "display_name": resolution["display_name"],
        "message": resolution["message"],
        "suggestions": [cast(str, resolution["display_name"])],
        "launched": bool(result["ok"]),
        "reason": "resolved",
        "raw_request": app_name.strip(),
        "metadata": result,
    }
