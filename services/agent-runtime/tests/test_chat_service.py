from pathlib import Path

import app.preferences as preferences
from app.chat.providers import ChatProviderResult
from app.chat.service import generate_companion_reply


class FakeProvider:
    provider_name = "fake-local"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def generate_reply(self, message: str, model_name: str) -> ChatProviderResult:
        self.calls.append((message, model_name))
        return ChatProviderResult(
            ok=True,
            message=f"Handled {message}",
            provider=self.provider_name,
            model=model_name,
        )


class UnavailableProvider:
    provider_name = "fake-local"

    def generate_reply(self, message: str, model_name: str) -> ChatProviderResult:
        return ChatProviderResult(
            ok=False,
            message=(
                f"I am almost ready, but my local model {model_name} is not loaded yet. "
                "Open the setup flow or pull the model locally, then I can answer properly."
            ),
            provider=self.provider_name,
            model=model_name,
        )


def test_selected_model_defaults_to_recommended(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)

    assert preferences.get_selected_model() == "llama3.1:8b-instruct"


def test_generate_companion_reply_uses_persisted_model_selection(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    preferences.set_selected_model("mistral-small:24b-instruct")

    fake_provider = FakeProvider()
    monkeypatch.setattr("app.chat.service.get_chat_provider", lambda: fake_provider)

    result = generate_companion_reply("hello there")

    assert result.ok is True
    assert result.provider == "fake-local"
    assert result.model == "mistral-small:24b-instruct"
    assert fake_provider.calls == [("hello there", "mistral-small:24b-instruct")]


def test_generate_companion_reply_returns_graceful_unavailable_model_message(
    tmp_path: Path,
    monkeypatch,
) -> None:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    preferences.set_selected_model("qwen2.5-coder:7b-instruct")
    monkeypatch.setattr(
        "app.chat.service.get_chat_provider",
        lambda: UnavailableProvider(),
    )

    result = generate_companion_reply("help me plan my day")

    assert result.ok is False
    assert result.provider == "fake-local"
    assert result.model == "qwen2.5-coder:7b-instruct"
    assert "not loaded yet" in result.message
