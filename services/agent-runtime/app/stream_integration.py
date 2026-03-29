"""Local stream integration settings and recent event history."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from threading import Lock
from typing import Final, Literal, TypedDict

from app.runtime_paths import runtime_data_path

STREAM_INTEGRATION_STATE_FILE = runtime_data_path("stream_integration.json")
MAX_STREAM_EVENTS: Final[int] = 20
StreamProvider = Literal["twitch", "youtube"]
StreamEventType = Literal[
    "new_subscriber",
    "donation",
    "new_member",
    "super_chat",
]


class StreamReactionPreferences(TypedDict):
    new_subscriber: bool
    donation: bool
    new_member: bool
    super_chat: bool


class StreamSettings(TypedDict):
    enabled: bool
    provider: StreamProvider
    overlay_enabled: bool
    click_through_enabled: bool
    twitch_channel_name: str
    twitch_webhook_secret: str
    youtube_live_chat_id: str
    reaction_preferences: StreamReactionPreferences


class StreamEvent(TypedDict):
    id: int
    provider: StreamProvider
    type: StreamEventType
    actor_name: str
    amount_display: str | None
    message: str | None
    bubble_text: str
    created_at: str
    should_react: bool


class StreamIntegrationState(TypedDict):
    next_event_id: int
    settings: StreamSettings
    recent_events: list[StreamEvent]


class TwitchWebhookResult(TypedDict, total=False):
    kind: Literal["challenge", "event", "ignored"]
    challenge: str
    event: StreamEvent
    reason: str


_stream_integration_lock = Lock()


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _default_reaction_preferences() -> StreamReactionPreferences:
    return {
        "new_subscriber": True,
        "donation": True,
        "new_member": True,
        "super_chat": True,
    }


def _default_settings() -> StreamSettings:
    return {
        "enabled": False,
        "provider": "twitch",
        "overlay_enabled": False,
        "click_through_enabled": False,
        "twitch_channel_name": "",
        "twitch_webhook_secret": "",
        "youtube_live_chat_id": "",
        "reaction_preferences": _default_reaction_preferences(),
    }


def _default_state() -> StreamIntegrationState:
    return {
        "next_event_id": 1,
        "settings": _default_settings(),
        "recent_events": [],
    }


def _ensure_state_file() -> None:
    if STREAM_INTEGRATION_STATE_FILE.exists():
        return

    STREAM_INTEGRATION_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STREAM_INTEGRATION_STATE_FILE.write_text(
        json.dumps(_default_state(), indent=2),
        encoding="utf-8",
    )


def _normalize_reaction_preferences(raw: object) -> StreamReactionPreferences:
    if not isinstance(raw, dict):
        return _default_reaction_preferences()

    defaults = _default_reaction_preferences()
    return {
        "new_subscriber": bool(
            raw.get("new_subscriber", defaults["new_subscriber"])
        ),
        "donation": bool(raw.get("donation", defaults["donation"])),
        "new_member": bool(raw.get("new_member", defaults["new_member"])),
        "super_chat": bool(raw.get("super_chat", defaults["super_chat"])),
    }


def _normalize_settings(raw: object) -> StreamSettings:
    defaults = _default_settings()
    if not isinstance(raw, dict):
        return defaults

    provider = str(raw.get("provider", defaults["provider"])).strip().lower()
    if provider not in {"twitch", "youtube"}:
        provider = defaults["provider"]

    click_through_enabled = bool(
        raw.get("click_through_enabled", defaults["click_through_enabled"])
    )
    overlay_enabled = bool(raw.get("overlay_enabled", defaults["overlay_enabled"]))
    if not overlay_enabled:
        click_through_enabled = False

    return {
        "enabled": bool(raw.get("enabled", defaults["enabled"])),
        "provider": provider,  # type: ignore[typeddict-item]
        "overlay_enabled": overlay_enabled,
        "click_through_enabled": click_through_enabled,
        "twitch_channel_name": str(
            raw.get("twitch_channel_name", defaults["twitch_channel_name"])
        ).strip(),
        "twitch_webhook_secret": str(
            raw.get("twitch_webhook_secret", defaults["twitch_webhook_secret"])
        ).strip(),
        "youtube_live_chat_id": str(
            raw.get("youtube_live_chat_id", defaults["youtube_live_chat_id"])
        ).strip(),
        "reaction_preferences": _normalize_reaction_preferences(
            raw.get("reaction_preferences")
        ),
    }


def _normalize_event_type(raw: object) -> StreamEventType | None:
    value = str(raw or "").strip().lower()
    if value in {"new_subscriber", "donation", "new_member", "super_chat"}:
        return value  # type: ignore[return-value]
    return None


def _normalize_recent_events(raw: object) -> list[StreamEvent]:
    if not isinstance(raw, list):
        return []

    normalized: list[StreamEvent] = []
    for item in raw:
        if not isinstance(item, dict):
            continue

        event_type = _normalize_event_type(item.get("type"))
        provider = str(item.get("provider", "")).strip().lower()
        if (
            not isinstance(item.get("id"), int)
            or event_type is None
            or provider not in {"twitch", "youtube"}
        ):
            continue

        normalized.append(
            {
                "id": int(item["id"]),
                "provider": provider,  # type: ignore[typeddict-item]
                "type": event_type,
                "actor_name": str(item.get("actor_name", "Someone")).strip()
                or "Someone",
                "amount_display": (
                    str(item.get("amount_display")).strip()
                    if item.get("amount_display") is not None
                    else None
                ),
                "message": (
                    str(item.get("message")).strip()
                    if item.get("message") is not None
                    else None
                ),
                "bubble_text": str(item.get("bubble_text", "")).strip(),
                "created_at": str(item.get("created_at", _now_iso())),
                "should_react": bool(item.get("should_react", True)),
            }
        )

    return normalized[:MAX_STREAM_EVENTS]


def _read_state() -> StreamIntegrationState:
    _ensure_state_file()
    with STREAM_INTEGRATION_STATE_FILE.open("r", encoding="utf-8") as file_handle:
        raw_state = json.load(file_handle)

    if not isinstance(raw_state, dict):
        return _default_state()

    next_event_id = raw_state.get("next_event_id", 1)
    if not isinstance(next_event_id, int) or next_event_id < 1:
        next_event_id = 1

    return {
        "next_event_id": next_event_id,
        "settings": _normalize_settings(raw_state.get("settings")),
        "recent_events": _normalize_recent_events(raw_state.get("recent_events")),
    }


def _write_state(state: StreamIntegrationState) -> None:
    STREAM_INTEGRATION_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STREAM_INTEGRATION_STATE_FILE.write_text(
        json.dumps(state, indent=2),
        encoding="utf-8",
    )


def _build_bubble_text(
    *,
    provider: StreamProvider,
    event_type: StreamEventType,
    actor_name: str,
    amount_display: str | None,
) -> str:
    if event_type == "new_subscriber":
        return (
            f"{actor_name} just subscribed on Twitch."
            if provider == "twitch"
            else f"{actor_name} just joined as a member."
        )
    if event_type == "donation":
        amount = amount_display or "a donation"
        return f"{actor_name} just sent {amount}."
    if event_type == "new_member":
        return f"{actor_name} just became a YouTube member."
    return f"{actor_name} sent a Super Chat for {amount_display or 'support'}."


def _record_event(
    state: StreamIntegrationState,
    *,
    provider: StreamProvider,
    event_type: StreamEventType,
    actor_name: str,
    amount_display: str | None = None,
    message: str | None = None,
) -> StreamEvent:
    should_react = state["settings"]["reaction_preferences"][event_type]
    event = {
        "id": state["next_event_id"],
        "provider": provider,
        "type": event_type,
        "actor_name": actor_name.strip() or "Someone",
        "amount_display": amount_display.strip() if amount_display else None,
        "message": message.strip() if message else None,
        "bubble_text": _build_bubble_text(
            provider=provider,
            event_type=event_type,
            actor_name=actor_name.strip() or "Someone",
            amount_display=amount_display.strip() if amount_display else None,
        ),
        "created_at": _now_iso(),
        "should_react": should_react,
    }
    state["next_event_id"] += 1
    state["recent_events"].insert(0, event)
    state["recent_events"] = state["recent_events"][:MAX_STREAM_EVENTS]
    return event


def get_stream_state() -> dict[str, object]:
    """Return persisted stream settings and recent events."""

    with _stream_integration_lock:
        state = _read_state()
        return {
            "settings": {
                **state["settings"],
                "reaction_preferences": state["settings"]["reaction_preferences"].copy(),
            },
            "recent_events": [event.copy() for event in state["recent_events"]],
        }


def list_recent_stream_events() -> list[StreamEvent]:
    """Return the recent stream event history."""

    with _stream_integration_lock:
        state = _read_state()
        return [event.copy() for event in state["recent_events"]]


def clear_recent_stream_events() -> int:
    """Clear recent stored stream events."""

    with _stream_integration_lock:
        state = _read_state()
        deleted = len(state["recent_events"])
        state["recent_events"] = []
        _write_state(state)
        return deleted


def update_stream_settings(
    *,
    enabled: bool | None = None,
    provider: str | None = None,
    overlay_enabled: bool | None = None,
    click_through_enabled: bool | None = None,
    twitch_channel_name: str | None = None,
    twitch_webhook_secret: str | None = None,
    youtube_live_chat_id: str | None = None,
    reaction_preferences: dict[str, bool] | None = None,
) -> StreamSettings:
    """Persist stream integration settings."""

    with _stream_integration_lock:
        state = _read_state()
        settings = state["settings"]

        if enabled is not None:
            settings["enabled"] = enabled
        if provider is not None:
            normalized_provider = provider.strip().lower()
            if normalized_provider not in {"twitch", "youtube"}:
                raise ValueError(f"Unsupported stream provider: {normalized_provider}")
            settings["provider"] = normalized_provider  # type: ignore[typeddict-item]
        if overlay_enabled is not None:
            settings["overlay_enabled"] = overlay_enabled
            if not overlay_enabled:
                settings["click_through_enabled"] = False
        if click_through_enabled is not None:
            settings["click_through_enabled"] = (
                click_through_enabled and settings["overlay_enabled"]
            )
        if twitch_channel_name is not None:
            settings["twitch_channel_name"] = twitch_channel_name.strip()
        if twitch_webhook_secret is not None:
            settings["twitch_webhook_secret"] = twitch_webhook_secret.strip()
        if youtube_live_chat_id is not None:
            settings["youtube_live_chat_id"] = youtube_live_chat_id.strip()
        if reaction_preferences is not None:
            current = settings["reaction_preferences"]
            for key, value in reaction_preferences.items():
                normalized_key = key.strip().lower()
                if normalized_key not in current:
                    raise ValueError(
                        f"Unsupported stream reaction preference: {normalized_key}"
                    )
                current[normalized_key] = bool(value)  # type: ignore[index]

        _write_state(state)
        return {
            **settings,
            "reaction_preferences": settings["reaction_preferences"].copy(),
        }


def create_preview_stream_event(event_type: str) -> StreamEvent:
    """Create a preview stream event for the desktop shell."""

    normalized_type = _normalize_event_type(event_type)
    if normalized_type is None:
        raise ValueError(f"Unsupported preview stream event: {event_type}")

    with _stream_integration_lock:
        state = _read_state()
        provider = state["settings"]["provider"]
        if normalized_type == "new_subscriber":
            event = _record_event(
                state,
                provider=provider,
                event_type=normalized_type,
                actor_name="Ari",
            )
        elif normalized_type == "donation":
            event = _record_event(
                state,
                provider=provider,
                event_type=normalized_type,
                actor_name="Mika",
                amount_display="$5.00",
                message="Keep going.",
            )
        elif normalized_type == "new_member":
            event = _record_event(
                state,
                provider="youtube",
                event_type=normalized_type,
                actor_name="Jordan",
            )
        else:
            event = _record_event(
                state,
                provider="youtube",
                event_type=normalized_type,
                actor_name="Taylor",
                amount_display="$10.00",
                message="Love the stream.",
            )
        _write_state(state)
        return event.copy()


def _verify_twitch_signature(
    *,
    secret: str,
    message_id: str,
    timestamp: str,
    signature: str,
    raw_body: bytes,
) -> None:
    expected_signature = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        message_id.encode("utf-8") + timestamp.encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, signature):
        raise ValueError("Invalid Twitch EventSub signature.")


def process_twitch_webhook(
    *,
    headers: dict[str, str],
    raw_body: bytes,
) -> TwitchWebhookResult:
    """Handle Twitch EventSub webhook challenges and supported notifications."""

    message_type = headers.get("twitch-eventsub-message-type", "").strip().lower()
    if not raw_body:
        raise ValueError("Twitch webhook payload must not be empty.")

    payload = json.loads(raw_body.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Twitch webhook payload must be a JSON object.")

    if message_type == "webhook_callback_verification":
        challenge = str(payload.get("challenge", "")).strip()
        if not challenge:
            raise ValueError("Missing Twitch EventSub challenge.")
        return {"kind": "challenge", "challenge": challenge}

    with _stream_integration_lock:
        state = _read_state()
        settings = state["settings"]

        secret = settings["twitch_webhook_secret"].strip()
        if secret:
            message_id = headers.get("twitch-eventsub-message-id", "").strip()
            timestamp = headers.get("twitch-eventsub-message-timestamp", "").strip()
            signature = headers.get("twitch-eventsub-message-signature", "").strip()
            if not message_id or not timestamp or not signature:
                raise ValueError("Missing Twitch EventSub verification headers.")
            _verify_twitch_signature(
                secret=secret,
                message_id=message_id,
                timestamp=timestamp,
                signature=signature,
                raw_body=raw_body,
            )

        if not settings["enabled"]:
            return {"kind": "ignored", "reason": "Stream integration is disabled."}

        subscription = payload.get("subscription", {})
        event = payload.get("event", {})
        if not isinstance(subscription, dict) or not isinstance(event, dict):
            raise ValueError("Unsupported Twitch EventSub payload.")

        subscription_type = str(subscription.get("type", "")).strip()
        if subscription_type == "channel.subscribe":
            recorded = _record_event(
                state,
                provider="twitch",
                event_type="new_subscriber",
                actor_name=str(event.get("user_name", "A viewer")),
            )
        elif subscription_type == "channel.cheer":
            actor_name = (
                "Anonymous"
                if bool(event.get("is_anonymous", False))
                else str(event.get("user_name", "A viewer"))
            )
            recorded = _record_event(
                state,
                provider="twitch",
                event_type="donation",
                actor_name=actor_name,
                amount_display=f'{int(event.get("bits", 0))} bits',
                message=str(event.get("message", "")).strip() or None,
            )
        else:
            raise ValueError(f"Unsupported Twitch EventSub type: {subscription_type}")

        _write_state(state)
        return {"kind": "event", "event": recorded.copy()}


def ingest_youtube_event(payload: dict[str, object]) -> StreamEvent:
    """Store a supported YouTube live event from a polling relay or preview bridge."""

    if not isinstance(payload, dict):
        raise ValueError("YouTube event payload must be a JSON object.")

    with _stream_integration_lock:
        state = _read_state()
        if not state["settings"]["enabled"]:
            raise ValueError("Stream integration is disabled.")

        snippet = payload.get("snippet", {})
        author_details = payload.get("authorDetails", {})
        if isinstance(snippet, dict):
            message_type = str(snippet.get("type", "")).strip()
            actor_name = "A viewer"
            if isinstance(author_details, dict):
                actor_name = str(author_details.get("displayName", "A viewer")).strip()
            elif snippet.get("authorChannelId") is not None:
                actor_name = str(snippet.get("authorChannelId", "A viewer")).strip()

            if message_type == "newSponsorEvent":
                event = _record_event(
                    state,
                    provider="youtube",
                    event_type="new_member",
                    actor_name=actor_name,
                )
            elif message_type == "superChatEvent":
                super_chat_details = snippet.get("superChatDetails", {})
                amount_display = None
                if isinstance(super_chat_details, dict):
                    amount_display = str(
                        super_chat_details.get("amountDisplayString", "")
                    ).strip() or None
                    message = str(super_chat_details.get("userComment", "")).strip() or None
                else:
                    message = None
                event = _record_event(
                    state,
                    provider="youtube",
                    event_type="super_chat",
                    actor_name=actor_name,
                    amount_display=amount_display,
                    message=message,
                )
            else:
                raise ValueError(f"Unsupported YouTube live message type: {message_type}")
        else:
            event_type = _normalize_event_type(payload.get("type"))
            if event_type not in {"new_member", "super_chat"}:
                raise ValueError("Unsupported YouTube event payload.")

            event = _record_event(
                state,
                provider="youtube",
                event_type=event_type,
                actor_name=str(payload.get("actor_name", "A viewer")),
                amount_display=(
                    str(payload.get("amount_display", "")).strip() or None
                ),
                message=str(payload.get("message", "")).strip() or None,
            )

        _write_state(state)
        return event.copy()
