"""Node-backed app launcher tool."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Literal, TypedDict


SupportedAppName = Literal["spotify", "discord"]


class OpenAppResult(TypedDict):
    """Structured result returned by the Node launcher."""

    ok: bool
    app: SupportedAppName
    message: str


SCRIPT_PATH = Path(__file__).with_suffix(".js")


def open_app(app_name: SupportedAppName) -> OpenAppResult:
    """Launch a supported desktop app through the Node helper."""

    completed_process = subprocess.run(
        ["node", str(SCRIPT_PATH), app_name],
        check=False,
        capture_output=True,
        text=True,
    )

    if completed_process.returncode != 0:
        error_detail = completed_process.stderr.strip() or "Unknown launch failure"
        raise RuntimeError(error_detail)

    stdout = completed_process.stdout.strip()
    if not stdout:
        raise RuntimeError("Launcher did not return a result")

    payload = json.loads(stdout)
    return OpenAppResult(
        ok=bool(payload["ok"]),
        app=payload["app"],
        message=payload["message"],
    )
