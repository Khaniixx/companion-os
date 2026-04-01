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

## Engineering Notes

- [MVP Roadmap](./engineering/mvp-roadmap.md)
  This is the current source of truth for product priority, release scope, and
  milestone order.
- [Milestone 3 Embodiment Plan](./engineering/milestone-3-embodiment-plan.md)
  This is the execution plan for voice, avatar, desktop presence, and window
  attachment work after Milestone 2.
- [Milestone 3 Embodiment Reference](./engineering/m3-embodiment-reference.md)
  This captures the preferred Milestone 3 workflow upgrades, AIRI-inspired
  embodiment targets, and the external references worth studying or adapting.

## Testing Expectations

- Backend runtime work should be covered with `pytest` and `fastapi.testclient`.
- Desktop UI work should be covered with Vitest and React Testing Library.
- Installer UI copy and layout changes can be reviewed locally with
  `npm run preview:installer` from `apps/desktop`.
- Treat that installer preview harness as the default contributor workflow for
  future installer UI changes. Prefer it over ad hoc preview files or repeated
  full installer reruns when validating small visual improvements.
- When behavior, contracts, or recovery flows change, update the relevant API doc
  and the top-level README in the same slice.

## MVP Workflow

- Installer and runtime flows stay local-first by default.
- Progress indicators should remain explicit during onboarding and repair.
- Personality packs, memory controls, utilities, streaming, and marketplace
  browsing should all remain part of one continuous companion experience.
- Streaming and creator-facing systems remain lower-priority foundations for the
  current phase. Keep them stable and secure, but do not let them outrank
  Windows release quality, companion identity, embodiment, or reliable core
  actions.
