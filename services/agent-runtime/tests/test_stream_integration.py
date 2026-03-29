import hashlib
import hmac
import json

import pytest

import app.stream_integration as stream_integration


@pytest.fixture(autouse=True)
def temp_stream_state(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        stream_integration,
        "STREAM_INTEGRATION_STATE_FILE",
        tmp_path / "stream_integration.json",
    )


def test_update_stream_settings_disables_click_through_when_overlay_is_off() -> None:
    stream_integration.update_stream_settings(
        overlay_enabled=True,
        click_through_enabled=True,
    )

    settings = stream_integration.update_stream_settings(overlay_enabled=False)

    assert settings["overlay_enabled"] is False
    assert settings["click_through_enabled"] is False


def test_process_twitch_webhook_validates_signature_when_secret_is_present() -> None:
    stream_integration.update_stream_settings(
        enabled=True,
        twitch_webhook_secret="topsecret",
    )
    payload = {
        "subscription": {"type": "channel.cheer"},
        "event": {
            "user_name": "Mika",
            "bits": 500,
            "message": "Hype!",
        },
    }
    raw_body = json.dumps(payload).encode("utf-8")
    message_id = "abc123"
    timestamp = "2026-03-29T00:00:00Z"
    signature = "sha256=" + hmac.new(
        b"topsecret",
        message_id.encode("utf-8") + timestamp.encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    result = stream_integration.process_twitch_webhook(
        headers={
            "twitch-eventsub-message-type": "notification",
            "twitch-eventsub-message-id": message_id,
            "twitch-eventsub-message-timestamp": timestamp,
            "twitch-eventsub-message-signature": signature,
        },
        raw_body=raw_body,
    )

    assert result["kind"] == "event"
    assert result["event"]["type"] == "donation"
    assert result["event"]["amount_display"] == "500 bits"


def test_ingest_youtube_event_rejects_unsupported_type() -> None:
    stream_integration.update_stream_settings(enabled=True, provider="youtube")

    with pytest.raises(ValueError, match="Unsupported YouTube live message type"):
        stream_integration.ingest_youtube_event(
            {
                "snippet": {"type": "textMessageEvent"},
                "authorDetails": {"displayName": "Viewer"},
            }
        )


def test_clear_recent_stream_events_returns_deleted_count() -> None:
    stream_integration.create_preview_stream_event("new_subscriber")
    stream_integration.create_preview_stream_event("super_chat")

    deleted = stream_integration.clear_recent_stream_events()

    assert deleted == 2
    assert stream_integration.list_recent_stream_events() == []
