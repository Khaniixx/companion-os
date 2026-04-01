"""Optional local voice-engine bridge for pack-driven speech output."""

from __future__ import annotations

from dataclasses import dataclass
from importlib import import_module
from io import BytesIO
from threading import Lock
from typing import Any


class VoiceBridgeError(RuntimeError):
    """Raised when the local voice bridge cannot synthesize audio."""


@dataclass(frozen=True)
class VoiceBridgeStatus:
    """Runtime availability for a local pack voice provider."""

    ready: bool
    detail: str


_model_lock = Lock()
_loaded_models: dict[tuple[str, str], Any] = {}


def get_local_voice_bridge_status(
    provider: str,
    *,
    model_id: str | None = None,
) -> VoiceBridgeStatus:
    """Return whether a local provider bridge is available in this runtime."""

    normalized_provider = provider.strip().lower()
    normalized_model_id = (model_id or "").strip().lower()

    if normalized_provider != "chatterbox":
        return VoiceBridgeStatus(
            ready=False,
            detail="Only the Chatterbox local voice bridge is connected right now.",
        )

    try:
        _get_chatterbox_runtime()
    except VoiceBridgeError as error:
        return VoiceBridgeStatus(ready=False, detail=str(error))

    if normalized_model_id in {
        "",
        "chatterbox-turbo",
        "chatterbox",
        "chatterbox-multilingual",
    }:
        return VoiceBridgeStatus(
            ready=True,
            detail="Chatterbox is importable in the local runtime.",
        )

    return VoiceBridgeStatus(
        ready=True,
        detail="Chatterbox is importable, but this model id will fall back to the base Chatterbox loader.",
    )


def synthesize_chatterbox_speech(
    *,
    text: str,
    voice_id: str,
    model_id: str | None = None,
    locale: str | None = None,
    style: str | None = None,
    reference_sample_path: str | None = None,
) -> tuple[bytes, str]:
    """Generate WAV audio through the optional local Chatterbox runtime."""

    normalized_text = text.strip()
    if not normalized_text:
        raise VoiceBridgeError("Voice synthesis needs non-empty text.")

    chatterbox_runtime = _get_chatterbox_runtime()
    torch = chatterbox_runtime["torch"]
    torchaudio = chatterbox_runtime["torchaudio"]
    model_bundle = _get_chatterbox_model(
        chatterbox_runtime,
        model_id=model_id,
    )
    model = model_bundle["model"]
    sample_rate = model_bundle["sample_rate"]
    generation_kwargs = _build_chatterbox_generation_kwargs(
        model_kind=model_bundle["kind"],
        locale=locale,
        style=style,
        reference_sample_path=reference_sample_path,
        voice_id=voice_id,
    )

    try:
        waveform = model.generate(normalized_text, **generation_kwargs)
    except Exception as error:  # pragma: no cover - external model failure surface
        raise VoiceBridgeError(
            f"Chatterbox could not synthesize speech: {error}"
        ) from error

    if not hasattr(waveform, "detach"):
        raise VoiceBridgeError("Chatterbox returned an unexpected audio tensor.")

    audio_tensor = waveform.detach()
    if hasattr(audio_tensor, "cpu"):
        audio_tensor = audio_tensor.cpu()
    if getattr(audio_tensor, "ndim", 0) == 1:
        audio_tensor = audio_tensor.unsqueeze(0)
    audio_tensor = torch.clamp(audio_tensor, min=-1.0, max=1.0)

    wav_buffer = BytesIO()
    torchaudio.save(wav_buffer, audio_tensor, sample_rate, format="wav")
    return wav_buffer.getvalue(), "audio/wav"


def _get_chatterbox_runtime() -> dict[str, Any]:
    try:
        torch = import_module("torch")
        torchaudio = import_module("torchaudio")
        import_module("chatterbox")
    except ImportError as error:
        raise VoiceBridgeError(
            "Install the optional Chatterbox runtime in services/agent-runtime to use pack voice playback."
        ) from error

    return {
        "torch": torch,
        "torchaudio": torchaudio,
    }


def _get_chatterbox_model(
    chatterbox_runtime: dict[str, Any],
    *,
    model_id: str | None,
) -> dict[str, Any]:
    normalized_model_id = (model_id or "chatterbox-turbo").strip().lower()
    model_key = ("chatterbox", normalized_model_id)

    with _model_lock:
        cached_model = _loaded_models.get(model_key)
        if cached_model is not None:
            return cached_model

        torch = chatterbox_runtime["torch"]
        device = "cuda" if torch.cuda.is_available() else "cpu"

        if normalized_model_id == "chatterbox-multilingual":
            model_module = import_module("chatterbox.mtl_tts")
            model_class = getattr(model_module, "ChatterboxMultilingualTTS")
            model = model_class.from_pretrained(device=device)
            sample_rate = int(getattr(model, "sr", 24000))
            bundle = {
                "kind": "multilingual",
                "model": model,
                "sample_rate": sample_rate,
            }
        elif normalized_model_id in {"chatterbox-turbo", "chatterbox"}:
            if normalized_model_id == "chatterbox-turbo":
                model_module = import_module("chatterbox.tts_turbo")
                model_class = getattr(model_module, "ChatterboxTurboTTS")
                kind = "turbo"
            else:
                model_module = import_module("chatterbox.tts")
                model_class = getattr(model_module, "ChatterboxTTS")
                kind = "standard"

            model = model_class.from_pretrained(device=device)
            sample_rate = int(getattr(model, "sr", 24000))
            bundle = {
                "kind": kind,
                "model": model,
                "sample_rate": sample_rate,
            }
        else:
            model_module = import_module("chatterbox.tts")
            model_class = getattr(model_module, "ChatterboxTTS")
            model = model_class.from_pretrained(device=device)
            sample_rate = int(getattr(model, "sr", 24000))
            bundle = {
                "kind": "standard",
                "model": model,
                "sample_rate": sample_rate,
            }

        _loaded_models[model_key] = bundle
        return bundle


def _build_chatterbox_generation_kwargs(
    *,
    model_kind: str,
    locale: str | None,
    style: str | None,
    reference_sample_path: str | None,
    voice_id: str,
) -> dict[str, Any]:
    generation_kwargs: dict[str, Any] = {}

    if reference_sample_path:
        generation_kwargs["audio_prompt_path"] = reference_sample_path

    normalized_locale = (locale or "").strip().lower()
    if model_kind == "multilingual" and normalized_locale:
        generation_kwargs["language_id"] = normalized_locale.split("-", 1)[0]

    normalized_style = (style or "").strip().lower()
    if normalized_style in {"anime", "expressive", "dramatic"}:
        generation_kwargs["exaggeration"] = 0.65
        generation_kwargs["cfg_weight"] = 0.35
    elif normalized_style in {"warm", "gentle", "calm"}:
        generation_kwargs["exaggeration"] = 0.45
        generation_kwargs["cfg_weight"] = 0.4

    if voice_id.strip().lower().endswith("-fast"):
        generation_kwargs.setdefault("cfg_weight", 0.3)

    return generation_kwargs
