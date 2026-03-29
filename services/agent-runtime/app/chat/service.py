"""Chat service for routing companion replies through the selected provider."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Literal

from app.chat.providers import (
    ChatProvider,
    ChatProviderResult,
    ModelAvailability,
    OllamaChatProvider,
    inspect_ollama_model,
)
from app.personality_packs import get_active_pack_profile
from app.preferences import get_selected_model


logger = logging.getLogger(__name__)
MODEL_STATUS_CACHE_TTL_SECONDS = 10.0
ModelStatusState = Literal["ready", "loading", "missing"]


@dataclass(frozen=True)
class ChatServiceResult:
    """Response returned to the API layer."""

    ok: bool
    message: str
    provider: str
    model: str
    error_code: str | None = None
    display_name: str = "Companion"
    loading: bool = False


@dataclass(frozen=True)
class CachedModelStatus:
    """Cached readiness for the selected local model."""

    state: ModelStatusState
    message: str
    provider: str
    model: str
    present: bool
    loaded: bool
    checked_at_monotonic: float


_model_status_cache: dict[str, CachedModelStatus] = {}
_model_status_lock = Lock()
_generation_lock = Lock()


def get_chat_provider() -> ChatProvider:
    """Return the default MVP chat provider."""

    return OllamaChatProvider()


def _style_voice(profile: dict[str, object], *, direct: bool = False) -> str:
    style_blob = " ".join(
        [
            str(profile.get("system_prompt", "")),
            *[str(rule) for rule in profile.get("style_rules", [])],
        ]
    ).lower()

    if any(token in style_blob for token in ("gentle", "warm", "calm", "grounded")):
        return "gently" if direct else "softly"
    if any(token in style_blob for token in ("direct", "brisk", "precise")):
        return "plainly" if direct else "simply"
    return "warmly" if direct else "calmly"


def format_in_character_error(
    error_code: str,
    *,
    profile: dict[str, object] | None = None,
    model_name: str | None = None,
) -> str:
    """Map runtime failures into companion-like messages shaped by the active pack."""

    active_profile = profile or get_active_pack_profile()
    speaking_style = _style_voice(active_profile)
    direct_style = _style_voice(active_profile, direct=True)
    selected_model = (model_name or get_selected_model()).strip()

    if error_code in {"model_not_ready", "model_loading"}:
        return (
            f"I am {speaking_style} gathering my local thoughts. "
            "Stay with me a moment, then ask again."
        )
    if error_code == "model_missing":
        return (
            f"I am {speaking_style} missing my local model, {selected_model}. "
            "Open settings to choose another local model, or download this one first."
        )
    if error_code == "model_unavailable":
        return (
            f"I am {speaking_style} losing the thread with my local model for a moment. "
            "Try me again in a breath."
        )
    if error_code == "browser_unavailable":
        return (
            f"I am {direct_style} having trouble reaching the browser just now. "
            "Give me a moment and try again."
        )
    if error_code == "app_launch_failed":
        return (
            f"I am {direct_style} having trouble opening that app just now. "
            "Give me a moment and try again."
        )
    if error_code == "skill_failed":
        return (
            f"I am {speaking_style} sorry, that action slipped out of my hands. "
            "Please try once more."
        )

    return (
        f"I am {speaking_style} sorry, I lost the thread for a moment. "
        "Please try again."
    )


def _availability_to_status(availability: ModelAvailability) -> CachedModelStatus:
    if not availability.present:
        state: ModelStatusState = "missing"
        message = format_in_character_error(
            "model_missing",
            model_name=availability.model,
        )
    elif not availability.loaded:
        state = "loading"
        message = format_in_character_error(
            "model_loading",
            model_name=availability.model,
        )
    else:
        state = "ready"
        message = "Your local model is awake and ready."

    return CachedModelStatus(
        state=state,
        message=message,
        provider=availability.provider,
        model=availability.model,
        present=availability.present,
        loaded=availability.loaded,
        checked_at_monotonic=monotonic(),
    )


def _status_for_model(
    model_name: str,
    *,
    force_refresh: bool = False,
) -> CachedModelStatus:
    if not force_refresh:
        with _model_status_lock:
            cached_status = _model_status_cache.get(model_name)
            if (
                cached_status is not None
                and monotonic() - cached_status.checked_at_monotonic
                < MODEL_STATUS_CACHE_TTL_SECONDS
            ):
                return cached_status

    inspected_status = _availability_to_status(inspect_ollama_model(model_name))
    with _model_status_lock:
        _model_status_cache[model_name] = inspected_status
    return inspected_status


def get_selected_model_status(*, force_refresh: bool = False) -> dict[str, object]:
    """Return cached readiness for the persisted selected local model."""

    model_name = get_selected_model()
    status = _status_for_model(model_name, force_refresh=force_refresh)
    return {
        "provider": status.provider,
        "model": status.model,
        "state": status.state,
        "present": status.present,
        "loaded": status.loaded,
        "message": status.message,
    }


def _mark_model_ready(model_name: str, provider_name: str) -> None:
    with _model_status_lock:
        _model_status_cache[model_name] = CachedModelStatus(
            state="ready",
            message="Your local model is awake and ready.",
            provider=provider_name,
            model=model_name,
            present=True,
            loaded=True,
            checked_at_monotonic=monotonic(),
        )


def _mark_model_loading(model_name: str, provider_name: str) -> None:
    with _model_status_lock:
        _model_status_cache[model_name] = CachedModelStatus(
            state="loading",
            message=format_in_character_error(
                "model_loading",
                model_name=model_name,
            ),
            provider=provider_name,
            model=model_name,
            present=True,
            loaded=False,
            checked_at_monotonic=monotonic(),
        )


def generate_companion_reply(message: str) -> ChatServiceResult:
    """Generate a companion-style reply using the persisted model preference."""

    model_name = get_selected_model()
    pack_profile = get_active_pack_profile()
    provider = get_chat_provider()
    model_status = _status_for_model(model_name)

    if model_status.state == "missing":
        return ChatServiceResult(
            ok=False,
            message=model_status.message,
            provider=model_status.provider,
            model=model_status.model,
            error_code="model_missing",
            display_name=str(pack_profile["display_name"]),
        )

    if model_status.state == "loading":
        return ChatServiceResult(
            ok=False,
            message=model_status.message,
            provider=model_status.provider,
            model=model_status.model,
            error_code="model_loading",
            display_name=str(pack_profile["display_name"]),
            loading=True,
        )

    provider_result: ChatProviderResult
    try:
        with _generation_lock:
            provider_result = provider.generate_reply(
                message,
                model_name,
                system_prompt=str(pack_profile["system_prompt"]),
                style_rules=[str(rule) for rule in pack_profile.get("style_rules", [])],
                display_name=str(pack_profile["display_name"]),
            )
    except Exception:  # pragma: no cover - defensive runtime guard
        logger.exception("Local model generation failed unexpectedly")
        return ChatServiceResult(
            ok=False,
            message=format_in_character_error(
                "model_unavailable",
                profile=pack_profile,
                model_name=model_name,
            ),
            provider=getattr(provider, "provider_name", "ollama"),
            model=model_name,
            error_code="model_unavailable",
            display_name=str(pack_profile["display_name"]),
        )

    error_code = None
    response_message = provider_result.message
    loading = False

    if provider_result.ok:
        _mark_model_ready(model_name, provider_result.provider)
    else:
        normalized_message = provider_result.message.lower()
        if "not loaded yet" in normalized_message or "waking up" in normalized_message:
            error_code = "model_loading"
            loading = True
            _mark_model_loading(model_name, provider_result.provider)
        elif "missing" in normalized_message or "download" in normalized_message:
            error_code = "model_missing"
        else:
            error_code = "model_unavailable"
        response_message = format_in_character_error(
            error_code,
            profile=pack_profile,
            model_name=model_name,
        )

    return ChatServiceResult(
        ok=provider_result.ok,
        message=response_message,
        provider=provider_result.provider,
        model=provider_result.model,
        error_code=error_code,
        display_name=str(pack_profile["display_name"]),
        loading=loading,
    )
