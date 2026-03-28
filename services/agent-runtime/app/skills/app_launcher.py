"""Skill wrapper for opening supported desktop apps."""

from __future__ import annotations

from typing import Final, Literal, cast

from app.tools.open_app import OpenAppResult, open_app


SupportedAppName = Literal["spotify", "discord"]
SUPPORTED_APPS: Final[set[str]] = {"spotify", "discord"}


def launch_app_skill(app_name: SupportedAppName) -> OpenAppResult:
    """Launch an allowed app via the app-launcher skill."""

    normalized_app_name = app_name.strip().lower()
    if normalized_app_name not in SUPPORTED_APPS:
        raise ValueError(f"Unsupported app: {normalized_app_name}")

    return open_app(cast(SupportedAppName, normalized_app_name))
