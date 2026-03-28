"""Node-backed browser launcher tool."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import TypedDict


class OpenUrlResult(TypedDict):
    """Structured result returned by the Node browser launcher."""

    ok: bool
    url: str
    message: str


SCRIPT_PATH = Path(__file__).with_suffix(".js")


def open_url(url: str) -> OpenUrlResult:
    """Open a URL in the default system browser."""

    completed_process = subprocess.run(
        ["node", str(SCRIPT_PATH), url],
        check=False,
        capture_output=True,
        text=True,
    )

    if completed_process.returncode != 0:
        error_detail = completed_process.stderr.strip() or "Unknown browser failure"
        raise RuntimeError(error_detail)

    stdout = completed_process.stdout.strip()
    if not stdout:
        raise RuntimeError("Browser launcher did not return a result")

    payload = json.loads(stdout)
    return OpenUrlResult(
        ok=bool(payload["ok"]),
        url=str(payload["url"]),
        message=str(payload["message"]),
    )
