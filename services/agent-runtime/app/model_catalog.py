"""Shared model catalog for the local-first MVP path."""

from __future__ import annotations

from typing import Final


RECOMMENDED_LOCAL_MODEL: Final[str] = "llama3.1:8b-instruct"
SUPPORTED_LOCAL_MODELS: Final[tuple[str, ...]] = (
    RECOMMENDED_LOCAL_MODEL,
    "mistral-small:24b-instruct",
    "qwen2.5-coder:7b-instruct",
)
