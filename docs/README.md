# Companion OS Docs

This documentation set covers the current MVP foundation while preserving the
core product rule: one persistent companion, multiple states, no separate modes.

## Current API Docs

- [Personality Packs](./api/personality-packs.md)
- [Memory And Privacy](./api/memory-privacy.md)
- [Micro-Utilities API](./api/micro-utilities.md)
- [Stream Integration API](./api/stream-integration.md)
- [Curated Marketplace API](./api/marketplace.md)

## Platform Notes

- [Desktop Linux Notes](./desktop-linux.md)

## Testing Expectations

- Backend runtime work should be covered with `pytest` and `fastapi.testclient`.
- Desktop UI work should be covered with Vitest and React Testing Library.
- When behavior, contracts, or recovery flows change, update the relevant API doc
  and the top-level README in the same slice.

## MVP Workflow

- Installer and runtime flows stay local-first by default.
- Progress indicators should remain explicit during onboarding and repair.
- Personality packs, memory controls, utilities, streaming, and marketplace
  browsing should all remain part of one continuous companion experience.
