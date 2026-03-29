# Personality Packs

Companion OS personality packs are local-first archives that change the companion's presentation and default behavior without creating a separate assistant or product mode.

## `pack.json`

The runtime validates `pack.json` against the built-in schema. The manifest includes:

- `schema_version`, `id`, `name`, `version`
- `author` and `license`
- `content_rating`
- `personality`
- `memory_defaults`
- `capabilities`
- `security`
- `extensions`

### `personality`

`personality` contains the user-facing identity for the active pack:

- `display_name`
- `system_prompt`
- `style_rules`
- `voice`
- `avatar`

`avatar` can reference local assets such as:

- `icon_path`
- `model_path`
- `audio_cues`
- named animation states such as `idle_animation`, `listening_animation`, `thinking_animation`, `talking_animation`, and `reaction_animation`

### `memory_defaults`

`memory_defaults` defines the default memory posture for the pack:

- `long_term_memory_enabled`
- `summary_frequency_messages`
- `opt_out_flags`

### `capabilities`

The runtime accepts required and optional capability declarations with justifications. Unsupported capabilities are rejected at install time.

Current MVP capability allowlist:

- `app.launch`
- `browser.open`
- `filesystem.read`
- `memory.read`
- `memory.write`
- `microphone.listen`
- `network.http`
- `notifications.show`
- `overlay.render`

### `security`

`security` includes:

- `signature`
- `asset_hashes`

The runtime verifies the manifest signature with the declared RSA public key and checks every hashed asset before the pack is installed locally.

## Archive Layout

Signed packs are distributed as zip archives. The archive must contain exactly one `pack.json` manifest and all referenced local assets. Asset paths must stay inside the archive and must not use absolute paths or parent-directory traversal.

## API Endpoints

- `GET /api/packs`
  Returns installed packs and the current active selection.
- `GET /api/packs/schema`
  Returns the JSON schema used for `pack.json`.
- `POST /api/packs/install`
  Installs a signed zip archive sent as base64 payload from the desktop shell.
- `PUT /api/packs/active`
  Selects the active installed pack.
- `POST /api/packs/import-tavern-card`
  Converts a Tavern Card V2/V3 PNG into the local pack format and installs it.

## Tavern Card Conversion

The Tavern import path reads PNG metadata, maps supported fields into the pack manifest, stores unknown fields under `extensions.tavern_card.unknown_fields`, signs the generated manifest for local use, and installs the result into the same local pack library used by signed zip archives.
