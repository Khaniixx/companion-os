# Companion OS MVP Roadmap

This document is the current source of truth for Companion OS product
direction, milestone order, and release work.

Use it to keep implementation decisions aligned with the real goal:

**Companion OS should feel like a real companion with useful powers, not a
useful tool with a face.**

## Product North Star

Companion OS is not meant to become another generic AI tool or a desktop pet
with no utility.

It should become a real AI companion platform that combines:

- PetClaw-style ease of setup
- OpenClaw-style capabilities
- DesktopMate-style visible presence
- Sakura.fm-style personality consistency
- deep long-term customization, including local user-imported voice, avatar,
  and personality packs

The user should feel:

> I have a real companion on my PC that helps me and has a personality.

Not:

> I installed another AI tool.

## Core Product Rules

These are non-negotiable for the current phase:

- one seamless companion identity, not separate product modes
- local-first by default
- free/open-source model path for core usage
- easy setup for non-technical users
- visible desktop presence, not a hidden dashboard-only experience
- personality treated as a core system, not cosmetic decoration
- permissions, repair paths, and persistence treated as product requirements
- no dependency on directly shipping copyrighted characters or voices
- voice, avatar systems, and personality/custom packs treated as base product
  systems, not premium extras or late add-ons
- speech input, speech output, and richer model renderers treated as planned
  embodiment systems for the base product, not side experiments

## Architecture Summary

Companion OS currently ships as a Windows-first desktop MVP with these major
surfaces:

- `apps/desktop`: Tauri + React desktop shell
- `services/agent-runtime`: FastAPI runtime for installer flow, chat, routing,
  skills, persistence, memory, packs, and settings
- `packages/character-engine`: companion state and animation logic
- `docs/`: product, API, platform, and release notes

Primary runtime shape:

1. The desktop shell owns onboarding, workspace UI, settings, desk utilities,
   and companion presentation.
2. The runtime owns installer state, local-model chat, skills, routing,
   permissions, memory, preferences, and pack state.
3. The product stays local-first and should remain usable without API keys in
   the default path.

## Current Supported Scope

Current release intent:

- Supported: Windows desktop MVP
- Experimental: Linux and macOS

What is already in `main`:

- resilient installer flow with repair/retry state
- local-model-backed companion chat
- personality pack support
- app-launcher and browser-helper skills
- micro-utilities and local persistence
- memory and privacy controls
- stream/overlay foundations
- marketplace foundations

Those foundation systems exist, but they are not equal in priority.
Stream and creator-facing systems should be treated as later-phase foundations,
not active near-term product priorities.

## Release-Ready Definition For This MVP

For the first real MVP, release-ready means:

- Windows-first
- installer flow is understandable and resilient
- local model path works without API keys
- companion UI feels polished enough that normal users are not confused
- chat works reliably
- at least 2 to 4 real skills/actions work reliably
- persistence works across restarts
- character and personality feel intentional
- no major broken flows during first-run onboarding

Release-ready does **not** currently require:

- perfect animation fidelity
- full marketplace
- creator mode
- full stream integrations
- mobile
- dozens of characters
- advanced autonomous planning

## Risks And Known Gaps

Open issues that still affect the next release phase:

- Windows first-run setup still needs one final hardening pass around the Ollama
  handoff so the installer never appears stranded after external installer UI
  opens.
- Desktop presence is present, but it still needs stronger embodiment and
  companion feel before it reads as a polished product.
- Personality quality exists structurally, but the default companion identity
  and emotional continuity still need stronger intentionality.
- Linux remains blocked from supported-release status by real-machine validation
  gaps and the upstream `glib` / Tauri / Wry / GTK chain.
- macOS remains experimental and has not gone through equivalent packaging and
  runtime validation.
- Some Dependabot PRs remain open and should be handled selectively, not in
  bulk.

## Strategic Priority Order

For the current phase, optimize work in this order:

1. Windows release quality
2. companion identity and personality consistency
3. desktop presence and embodiment
4. reaction layer and subtle liveliness
5. reliable core actions and useful powers
6. only then broader capability expansion

Deprioritize unless directly needed:

- stream/creator mode
- new stream integrations or creator-facing polish
- marketplace depth
- large-scale pack ecosystem
- mobile
- advanced autonomy
- heavy multi-agent architecture

## Milestones

### Milestone 1: Windows MVP Hardening

Goal:
Make the current Windows-first MVP safely installable and usable by a normal
user.

Acceptance criteria:

- `npm run tauri build` succeeds from `main`
- Windows installer artifacts install cleanly
- first-run flow completes without leaving the user stranded
- local model/runtime handoff is clear and recoverable
- repair and settings paths are understandable to non-technical users
- release notes and troubleshooting guidance match actual behavior

### Milestone 2: Default Companion Identity

Goal:
Make the default companion feel intentional, personal, and consistent instead of
generic.

Acceptance criteria:

- the default pack has a clearly defined speaking style and emotional tone
- fallback, warm-up, and error messages stay in character
- the companion feels consistent across onboarding, chat, settings, and action
  confirmations
- personality is treated as a system-level concern, not just prompt flavor text

### Milestone 3: Desktop Presence And Embodiment

Goal:
Make the desktop shell feel like the beginning of a real embodied companion.

Detailed execution plan:

- [Milestone 3 Embodiment Plan](./milestone-3-embodiment-plan.md)

Acceptance criteria:

- visible companion presence feels polished enough for normal users
- movement, state changes, and idle behavior feel intentional rather than
  placeholder
- desktop presentation supports the product fantasy of an on-screen companion,
  not just a chat window with an avatar
- voice, avatar, and pack systems are clearly moving toward base-product
  customization instead of one fixed shell
- the product direction is clearly moving toward hearing, speaking, and richer
  renderer support such as Live2D or VRM adapters
- embodiment improvements do not break performance or core flows

### Milestone 4: Reaction Layer And Liveliness

Goal:
Improve subtle reactivity so the companion feels alive while staying
non-intrusive.

Acceptance criteria:

- listening, thinking, talking, idle, and reaction states feel naturally paced
- utility completions and meaningful actions trigger light reactions
- charming but restrained idle behavior exists
- error and recovery states still feel companion-like
- imported and pack-defined characters start to read as real identity shifts,
  not just presentation swaps
- local desk prompts can pull from a real context bundle that includes current
  continuity, unresolved notes/tasks, desk state, and pack character framing
- continuity can distinguish between a shared user thread and the active pack's
  thread so imported characters feel more distinct over time without pretending
  long-term memory is solved
  not only Aster with different assets

### Milestone 5: Reliable Core Actions

Goal:
Ensure the initial useful powers feel solid enough to support the companion
fantasy.

Acceptance criteria:

- chat remains reliable
- app launcher works reliably
- browser/search flows work reliably
- persistence survives restarts
- permissions remain explicit and understandable

### Milestone 6: Experimental Platform Foundations

Goal:
Keep Linux and macOS progressing as foundations only, without diluting the
Windows-first release plan.

Acceptance criteria:

- Ubuntu 24.04 Linux build/package requirements are documented
- packaging output status is known for experimental targets
- Linux/macOS remain explicitly marked experimental until proven otherwise
- upstream `glib` advisory status is documented accurately

## Deferred Foundations

These systems may remain present in the repo, but they should not outrank the
current Windows-first companion roadmap:

- stream overlays and stream event reactions
- creator-facing surfaces or co-host behavior
- broader marketplace depth

Use them as maintained foundations only. Prioritize new work there only when it
is required for security, stability, or a later explicitly approved milestone.

## Deployment Plan

The current deployment plan is Windows-first.

1. Confirm local development and CI are green from `main`
2. Build Windows desktop bundles
3. Run first-run installer validation on Windows
4. Smoke test chat, permissions, repair flow, and local model flow
5. Confirm the companion workspace feels coherent enough for normal users
6. Tag and publish Windows release artifacts
7. Keep Linux/macOS experimental until explicitly promoted

## Validation Commands

Use these commands as the minimum pre-release verification set:

```powershell
cd C:\Users\Grand\Downloads\companion-os\services\agent-runtime
.\.venv\Scripts\python -m pytest -q

cd C:\Users\Grand\Downloads\companion-os\apps\desktop
npm run test -- --run
npm run lint
npm run build
npm run tauri build
```

Additional packaging/security checks when relevant:

```powershell
cd C:\Users\Grand\Downloads\companion-os\apps\desktop
npm audit --audit-level=moderate

cd C:\Users\Grand\Downloads\companion-os\apps\desktop\src-tauri
cargo check --locked
cargo audit
```

## Rollback Notes

If a release-hardening or companion-quality change is unstable:

1. Revert the specific milestone branch/PR rather than layering hotfixes over a
   broken release path.
2. Re-run the validation commands above from clean `main`.
3. Update this document and `README.md` if supported scope or release guidance
   changed.

## Working Rule

Use this document the same way the recent MVP cleanup succeeded:

1. keep the plan updated when priorities change
2. implement one milestone or slice at a time
3. validate before merge
4. keep diffs reviewable
5. prefer product feel and companion identity over breadth
