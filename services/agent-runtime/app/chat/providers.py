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


class ChatProvider(Protocol):
    """Provider interface used by the runtime chat service."""

    provider_name: str

    def generate_reply(self, message: str, model_name: str) -> ChatProviderResult:
        """Generate a companion response for the supplied message."""


class OllamaChatProvider:
    """Local-first chat provider backed by Ollama."""

    provider_name = "ollama"

    def __init__(self, base_url: str = OLLAMA_URL) -> None:
        self.base_url = base_url.rstrip("/")

    def generate_reply(self, message: str, model_name: str) -> ChatProviderResult:
        try:
            with httpx.Client(base_url=self.base_url, timeout=20.0) as client:
                tags_response = client.get("/api/tags")
                tags_response.raise_for_status()
                available_models = tags_response.json().get("models", [])
                available_names = {
                    str(item.get("name", "")).strip().lower()
                    for item in available_models
                    if isinstance(item, dict)
                }

                if model_name not in available_names:
                    return ChatProviderResult(
                        ok=False,
                        message=(
                            f"I am almost ready, but my local model {model_name} is not loaded yet. "
                            "Open the setup flow or pull the model locally, then I can answer properly."
                        ),
                        provider=self.provider_name,
                        model=model_name,
                    )

                generate_response = client.post(
                    "/api/generate",
                    json={
                        "model": model_name,
                        "stream": False,
                        "prompt": (
                            "You are Companion OS, a warm, concise desktop companion. "
                            "Reply in 1-3 sentences, stay practical, and avoid technical dashboard language.\n\n"
                            f"User: {message}\nCompanion:"
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
