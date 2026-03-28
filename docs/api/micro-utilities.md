# Micro-Utilities API

Companion OS exposes first-party local micro-utilities through the runtime and keeps them inside the same companion conversation.

## Routes

- `GET /api/utilities/state`
  Returns stored timers, reminders, to-do notes, clipboard history, and quick-launch shortcuts.

- `POST /api/utilities/clipboard/capture`
  Stores clipboard text that the desktop shell reads locally from the current window session.

- `POST /api/skills/micro-utilities`
  Accepts a natural-language utility request such as:
  - `set a 5 minute timer`
  - `set an alarm for 7:30 pm`
  - `remind me to stretch in 10 minutes`
  - `add todo buy milk`
  - `show clipboard history`
  - `run shortcut spotify`

## Product Rules

- Utilities remain local-first and non-intrusive.
- Clipboard history stays on-device.
- Shortcuts that open apps or the browser still respect the existing persisted permissions.
- The desktop app should refresh the utility surface after successful utility actions and use the shared `reaction` state for brief acknowledgment rather than opening a separate mode.
