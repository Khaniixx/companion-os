"""Shared runtime logging setup for local support diagnostics."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


RUNTIME_LOG_FILE = Path(__file__).resolve().parents[1] / "data" / "runtime.log"
_LOGGER_NAME = "companion_runtime"


def setup_runtime_logging() -> logging.Logger:
    """Configure one rotating runtime log file for local diagnostics."""

    logger = logging.getLogger(_LOGGER_NAME)
    if logger.handlers:
        return logger

    RUNTIME_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    handler = RotatingFileHandler(
        RUNTIME_LOG_FILE,
        maxBytes=512_000,
        backupCount=2,
        encoding="utf-8",
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    )

    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    logger.propagate = False
    return logger
