"""Provider abstraction for companion chat responses."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx


OLLAMA_URL = "http://127.0.0.1:11434"


@dataclass(frozen=True)
class ChatProviderResult:
    """Normalized result returned by a chat provider."""

    ok: bool
    message: str
    provider: str
    model: str


@dataclass(frozen=True)
class ModelAvailability:
    """Presence and warm-load status for a local model."""

    provider: str
    model: str
    present: bool
    loaded: bool


class ChatProvider(Protocol):
    """Provider interface used by the runtime chat service."""

    provider_name: str

    def generate_reply(
        self,
        message: str,
        model_name: str,
        *,
        system_prompt: str,
        style_rules: list[str],
        display_name: str,
    ) -> ChatProviderResult:
        """Generate a companion response for the supplied message."""


def inspect_ollama_model(
    model_name: str,
    *,
    base_url: str = OLLAMA_URL,
    timeout: float = 5.0,
) -> ModelAvailability:
    """Inspect whether an Ollama model exists locally and is already loaded."""

    normalized_model_name = model_name.strip().lower()
    try:
        with httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout) as client:
            tags_response = client.get("/api/tags")
            tags_response.raise_for_status()
            loaded_response = client.get("/api/ps")
            loaded_response.raise_for_status()
    except httpx.HTTPError:
        return ModelAvailability(
            provider="ollama",
            model=normalized_model_name,
            present=True,
            loaded=False,
        )

    available_models = tags_response.json().get("models", [])
    running_models = loaded_response.json().get("models", [])
    available_names = {
        str(item.get("name", "")).strip().lower()
        for item in available_models
        if isinstance(item, dict)
    }
    running_names = {
        str(item.get("name", "")).strip().lower()
        for item in running_models
        if isinstance(item, dict)
    }

    return ModelAvailability(
        provider="ollama",
        model=normalized_model_name,
        present=normalized_model_name in available_names,
        loaded=normalized_model_name in running_names,
    )


class OllamaChatProvider:
    """Local-first chat provider backed by Ollama."""

    provider_name = "ollama"

    def __init__(self, base_url: str = OLLAMA_URL) -> None:
        self.base_url = base_url.rstrip("/")

    def generate_reply(
        self,
        message: str,
        model_name: str,
        *,
        system_prompt: str,
        style_rules: list[str],
        display_name: str,
    ) -> ChatProviderResult:
        style_rule_lines = "\n".join(f"- {rule}" for rule in style_rules if rule.strip())

        try:
            with httpx.Client(base_url=self.base_url, timeout=45.0) as client:
                generate_response = client.post(
                    "/api/generate",
                    json={
                        "model": model_name,
                        "stream": False,
                        "prompt": (
                            f"{system_prompt}\n\n"
                            f"Identity: You are {display_name}, the active companion inside Companion OS.\n"
                            "Reply in 1-3 sentences, stay practical, and avoid technical dashboard language.\n"
                            "Style rules:\n"
                            f"{style_rule_lines or '- Stay warm and concise.'}\n\n"
                            f"User: {message}\n{display_name}:"
                        ),
                    },
                )
                generate_response.raise_for_status()
                payload = generate_response.json()
        except httpx.HTTPError:
            return ChatProviderResult(
                ok=False,
                message=(
                    "I am still waking up on the local model runtime. Give me a moment to finish getting ready, "
                    "then try that again."
                ),
                provider=self.provider_name,
                model=model_name,
            )

        response_text = str(payload.get("response", "")).strip()
        if not response_text:
            return ChatProviderResult(
                ok=False,
                message=(
                    "I could not shape a reply from the local model just yet. "
                    "Try once more in a moment."
                ),
                provider=self.provider_name,
                model=model_name,
            )

        return ChatProviderResult(
            ok=True,
            message=response_text,
            provider=self.provider_name,
            model=model_name,
        )
