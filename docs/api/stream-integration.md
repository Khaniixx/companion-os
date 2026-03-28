# Stream Integration API

Companion OS keeps stream reactions inside the same persistent companion flow.

## State and Settings

- `GET /api/stream/state`
  Returns persisted stream settings plus recent stream events.

- `PUT /api/stream/settings`
  Persists stream provider, overlay settings, click-through preference, provider identifiers, and reaction toggles.

- `GET /api/stream/events`
  Returns the recent event history used by the desktop shell for polling.

- `DELETE /api/stream/events`
  Clears recent stored events.

## Event Intake

- `POST /api/stream/events/preview`
  Creates a local preview event so the desktop shell can tune reactions without a live stream.

- `POST /api/stream/webhooks/twitch`
  Handles Twitch EventSub webhook verification and supported notifications:
  - `channel.subscribe`
  - `channel.cheer`

- `POST /api/stream/events/youtube`
  Accepts a YouTube live event from a local relay or polling worker and currently supports:
  - `newSponsorEvent`
  - `superChatEvent`

## Product Rules

- Overlay behavior is a presentation state, not a second companion mode.
- Stream reactions should stay brief and non-intrusive.
- Unsupported provider events should be rejected clearly instead of being silently misinterpreted.
- Settings and recent events stay local to the device unless a future feature explicitly changes that behavior.
