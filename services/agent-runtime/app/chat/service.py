"""Chat service for routing companion replies through the selected provider."""

from __future__ import annotations

from dataclasses import dataclass

from app.chat.providers import ChatProvider, ChatProviderResult, OllamaChatProvider
from app.preferences import get_selected_model


@dataclass(frozen=True)
class ChatServiceResult:
    """Response returned to the API layer."""

    ok: bool
    message: str
    provider: str
    model: str


def get_chat_provider() -> ChatProvider:
    """Return the default MVP chat provider."""

    return OllamaChatProvider()


def generate_companion_reply(message: str) -> ChatServiceResult:
    """Generate a companion-style reply using the persisted model preference."""

    model_name = get_selected_model()
    provider = get_chat_provider()
    provider_result: ChatProviderResult = provider.generate_reply(message, model_name)
    return ChatServiceResult(
        ok=provider_result.ok,
        message=provider_result.message,
        provider=provider_result.provider,
        model=provider_result.model,
    )
