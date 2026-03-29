from pathlib import Path
from threading import Event, Lock, Thread
from time import sleep

import app.preferences as preferences
import app.chat.service as chat_service
from app.chat.providers import ChatProviderResult, ModelAvailability


class FakeProvider:
    provider_name = "fake-local"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, list[str], str]] = []

    def generate_reply(
        self,
        message: str,
        model_name: str,
        *,
        system_prompt: str,
        style_rules: list[str],
        display_name: str,
    ) -> ChatProviderResult:
        self.calls.append(
            (message, model_name, system_prompt, style_rules, display_name)
        )
        return ChatProviderResult(
            ok=True,
            message=f"Handled {message}",
            provider=self.provider_name,
            model=model_name,
        )


class ExplodingProvider:
    provider_name = "fake-local"

    def generate_reply(
        self,
        message: str,
        model_name: str,
        *,
        system_prompt: str,
        style_rules: list[str],
        display_name: str,
    ) -> ChatProviderResult:
        raise RuntimeError("provider blew up")


def _patch_active_pack(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.chat.service.get_active_pack_profile",
        lambda: {
            "id": "sunrise-companion",
            "display_name": "Sunrise",
            "system_prompt": "Stay calm and encouraging.",
            "style_rules": ["Use warm phrasing.", "Keep it practical."],
            "voice": {},
            "avatar": {},
        },
    )


def _patch_preferences(tmp_path: Path, monkeypatch) -> Path:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    chat_service._model_status_cache.clear()
    return preferences_file


def test_selected_model_defaults_to_recommended(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = _patch_preferences(tmp_path, monkeypatch)

    assert preferences_file.exists() is False
    assert preferences.get_selected_model() == "llama3.1:8b-instruct"


def test_generate_companion_reply_uses_persisted_model_selection(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _patch_preferences(tmp_path, monkeypatch)
    _patch_active_pack(monkeypatch)
    preferences.set_selected_model("mistral-small:24b-instruct")

    fake_provider = FakeProvider()
    monkeypatch.setattr("app.chat.service.get_chat_provider", lambda: fake_provider)
    monkeypatch.setattr(
        "app.chat.service.inspect_ollama_model",
        lambda model_name: ModelAvailability(
            provider="ollama",
            model=model_name,
            present=True,
            loaded=True,
        ),
    )

    result = chat_service.generate_companion_reply("hello there")

    assert result.ok is True
    assert result.loading is False
    assert result.provider == "fake-local"
    assert result.model == "mistral-small:24b-instruct"
    assert result.display_name == "Sunrise"
    assert fake_provider.calls == [
        (
            "hello there",
            "mistral-small:24b-instruct",
            "Stay calm and encouraging.",
            ["Use warm phrasing.", "Keep it practical."],
            "Sunrise",
        )
    ]


def test_model_status_reports_missing_model_without_exception(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _patch_preferences(tmp_path, monkeypatch)
    _patch_active_pack(monkeypatch)
    preferences.set_selected_model("qwen2.5-coder:7b-instruct")
    monkeypatch.setattr(
        "app.chat.service.inspect_ollama_model",
        lambda model_name: ModelAvailability(
            provider="ollama",
            model=model_name,
            present=False,
            loaded=False,
        ),
    )

    status = chat_service.get_selected_model_status(force_refresh=True)
    result = chat_service.generate_companion_reply("help me plan my day")

    assert status == {
        "provider": "ollama",
        "model": "qwen2.5-coder:7b-instruct",
        "state": "missing",
        "present": False,
        "loaded": False,
        "message": (
            "I am softly missing my local model, qwen2.5-coder:7b-instruct. "
            "Open settings to choose another local model, or download this one first."
        ),
    }
    assert result.ok is False
    assert result.loading is False
    assert result.error_code == "model_missing"
    assert "download this one first" in result.message


def test_generate_companion_reply_returns_loading_message_during_startup(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _patch_preferences(tmp_path, monkeypatch)
    _patch_active_pack(monkeypatch)
    preferences.set_selected_model("llama3.1:8b-instruct")

    provider_called = {"value": False}

    class ProviderShouldNotRun:
        provider_name = "fake-local"

        def generate_reply(self, *args, **kwargs) -> ChatProviderResult:
            provider_called["value"] = True
            return ChatProviderResult(
                ok=True,
                message="unexpected",
                provider=self.provider_name,
                model="llama3.1:8b-instruct",
            )

    monkeypatch.setattr(
        "app.chat.service.get_chat_provider",
        lambda: ProviderShouldNotRun(),
    )
    monkeypatch.setattr(
        "app.chat.service.inspect_ollama_model",
        lambda model_name: ModelAvailability(
            provider="ollama",
            model=model_name,
            present=True,
            loaded=False,
        ),
    )

    result = chat_service.generate_companion_reply("wake up")

    assert result.ok is False
    assert result.loading is True
    assert result.error_code == "model_loading"
    assert "gathering my local thoughts" in result.message
    assert provider_called["value"] is False


def test_generate_companion_reply_returns_fallback_when_provider_errors(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _patch_preferences(tmp_path, monkeypatch)
    _patch_active_pack(monkeypatch)
    monkeypatch.setattr(
        "app.chat.service.get_chat_provider",
        ExplodingProvider,
    )
    monkeypatch.setattr(
        "app.chat.service.inspect_ollama_model",
        lambda model_name: ModelAvailability(
            provider="ollama",
            model=model_name,
            present=True,
            loaded=True,
        ),
    )

    result = chat_service.generate_companion_reply("say hello")

    assert result.ok is False
    assert result.loading is False
    assert result.error_code == "model_unavailable"
    assert result.message == (
        "I am softly losing the thread with my local model for a moment. "
        "Try me again in a breath."
    )


def test_model_status_is_cached_to_avoid_repeated_expensive_checks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _patch_preferences(tmp_path, monkeypatch)
    _patch_active_pack(monkeypatch)

    inspect_calls = {"count": 0}

    def fake_inspect(model_name: str) -> ModelAvailability:
        inspect_calls["count"] += 1
        return ModelAvailability(
            provider="ollama",
            model=model_name,
            present=True,
            loaded=True,
        )

    monkeypatch.setattr("app.chat.service.inspect_ollama_model", fake_inspect)

    first = chat_service.get_selected_model_status(force_refresh=True)
    second = chat_service.get_selected_model_status()

    assert first["state"] == "ready"
    assert second["state"] == "ready"
    assert inspect_calls["count"] == 1


def test_generate_companion_reply_serializes_requests_while_generating(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _patch_preferences(tmp_path, monkeypatch)
    _patch_active_pack(monkeypatch)
    monkeypatch.setattr(
        "app.chat.service.inspect_ollama_model",
        lambda model_name: ModelAvailability(
            provider="ollama",
            model=model_name,
            present=True,
            loaded=True,
        ),
    )

    started = Event()
    release = Event()
    concurrency_lock = Lock()
    active_calls = {"count": 0, "max": 0}
    results: list[chat_service.ChatServiceResult] = []

    class SlowProvider:
        provider_name = "fake-local"

        def generate_reply(
            self,
            message: str,
            model_name: str,
            *,
            system_prompt: str,
            style_rules: list[str],
            display_name: str,
        ) -> ChatProviderResult:
            with concurrency_lock:
                active_calls["count"] += 1
                active_calls["max"] = max(
                    active_calls["max"],
                    active_calls["count"],
                )
            started.set()
            release.wait(timeout=1.0)
            sleep(0.01)
            with concurrency_lock:
                active_calls["count"] -= 1
            return ChatProviderResult(
                ok=True,
                message=f"Handled {message}",
                provider=self.provider_name,
                model=model_name,
            )

    monkeypatch.setattr(
        "app.chat.service.get_chat_provider",
        lambda: SlowProvider(),
    )

    def run_request(message: str) -> None:
        results.append(chat_service.generate_companion_reply(message))

    first_thread = Thread(target=run_request, args=("first",))
    second_thread = Thread(target=run_request, args=("second",))

    first_thread.start()
    started.wait(timeout=1.0)
    second_thread.start()
    sleep(0.05)
    release.set()
    first_thread.join(timeout=1.0)
    second_thread.join(timeout=1.0)

    assert len(results) == 2
    assert all(result.ok is True for result in results)
    assert active_calls["max"] == 1
