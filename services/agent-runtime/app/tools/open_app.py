"""Node-backed app launcher tool."""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Literal, TypedDict

from app.runtime_logging import setup_runtime_logging


SupportedAppName = Literal["spotify", "discord"]


class OpenAppResult(TypedDict):
    """Structured result returned by the Node launcher."""

    ok: bool
    app: SupportedAppName
    message: str


SCRIPT_PATH = Path(__file__).with_suffix(".js")
logger = logging.getLogger("companion_runtime.tools.open_app")


def open_app(app_name: SupportedAppName) -> OpenAppResult:
    """Launch a supported desktop app through the Node helper."""

    setup_runtime_logging()
    completed_process = subprocess.run(
        ["node", str(SCRIPT_PATH), app_name],
        check=False,
        capture_output=True,
        text=True,
    )

    if completed_process.returncode != 0:
        error_detail = completed_process.stderr.strip() or "Unknown launch failure"
        logger.error(
            "App launch failed for %s (returncode=%s, stdout=%r, stderr=%r)",
            app_name,
            completed_process.returncode,
            completed_process.stdout.strip(),
            completed_process.stderr.strip(),
        )
        raise RuntimeError(error_detail)

    stdout = completed_process.stdout.strip()
    if not stdout:
        logger.error("App launcher returned no stdout for %s", app_name)
        raise RuntimeError("Launcher did not return a result")

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        logger.error("App launcher returned invalid JSON for %s: %r", app_name, stdout)
        raise RuntimeError("Launcher returned an invalid result") from None

    return OpenAppResult(
        ok=bool(payload["ok"]),
        app=payload["app"],
        message=payload["message"],
    )
