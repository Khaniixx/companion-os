"""Executable entrypoint for the packaged Companion OS runtime."""

from __future__ import annotations

import os

import uvicorn
from app.main import app as fastapi_app


def main() -> None:
    """Start the local FastAPI runtime on the loopback interface."""

    uvicorn.run(
        fastapi_app,
        host=os.getenv("COMPANION_RUNTIME_HOST", "127.0.0.1"),
        port=int(os.getenv("COMPANION_RUNTIME_PORT", "8000")),
        log_level=os.getenv("COMPANION_RUNTIME_LOG_LEVEL", "warning"),
        access_log=False,
    )


if __name__ == "__main__":
    main()
