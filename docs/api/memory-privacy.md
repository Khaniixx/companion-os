# Memory And Privacy

Companion OS keeps long-term memory local by default. The MVP stores summarized conversation history on the device and lets the user edit or remove that memory at any time.

## Memory Model

The runtime stores:

- `pending_messages`
  Recent unsummarized chat turns waiting to reach the configured summary threshold.
- `summaries`
  Condensed local memory entries with:
  - `id`
  - `title`
  - `summary`
  - `message_count`
  - `created_at`
  - `updated_at`
  - `source`

When the pending message count reaches the configured threshold, the runtime generates a local summary and clears the pending buffer.

## Privacy Settings

The runtime persists these per-user settings:

- `long_term_memory_enabled`
- `summary_frequency_messages`
- `cloud_backup_enabled`

Defaults:

- long-term memory enabled
- summary frequency set to `25`
- cloud backup disabled

If long-term memory is disabled, new chat turns are not added to long-term memory and any pending unsummarized messages are cleared immediately.

## API Endpoints

- `GET /api/memory/settings`
  Returns the persisted long-term memory and privacy settings.
- `PUT /api/memory/settings`
  Updates local memory settings.
- `GET /api/memory/summaries`
  Returns stored summaries and the pending unsummarized message count.
- `PUT /api/memory/summaries/{summary_id}`
  Updates the title or summary text for a saved memory entry.
- `DELETE /api/memory/summaries/{summary_id}`
  Deletes one saved memory summary.
- `DELETE /api/memory/summaries`
  Clears all saved summaries and pending unsummarized messages.

## Desktop Behavior

The desktop settings surface exposes:

- local-only storage messaging
- long-term memory enable/disable
- summary frequency selection
- cloud-backup opt-in state
- summary list with edit and delete actions
- clear-all memory action

This keeps memory management within the same companion settings experience instead of moving it into a separate dashboard or mode.
