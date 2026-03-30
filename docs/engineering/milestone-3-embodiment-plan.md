# Milestone 3: Embodiment Plan

This document turns Milestone 3 from a high-level roadmap item into an
execution plan.

Milestone 3 is the phase where Companion OS moves from:

- a companion that feels intentional inside the current desktop shell

to:

- a companion that starts to feel embodied on the desktop itself

Use this plan to keep the next phase moving in larger, more useful slices
instead of tiny polish-only PRs.

## Goal

Make the desktop shell feel like the beginning of a real embodied companion.

This milestone should materially improve:

- voice presence
- avatar depth
- on-screen embodiment
- overlay and attachment behavior
- local custom pack readiness for voice, avatar, and personality identity
- the sense that the companion lives on the desktop, not only in a chat panel

## Current Starting Point

What already exists in `main`:

- a stable Windows-first packaged desktop shell
- one persistent companion identity
- personality pack metadata for:
  - `voice`
  - `avatar`
  - animation identifiers
  - audio cue references
- a visible avatar stage with idle, listening, thinking, talking, reaction, and
  error states
- local-first chat, core actions, persistence, settings, and repair flows
- overlay foundations and stream/desktop surface plumbing

What does **not** exist yet in a meaningful Milestone 3 sense:

- real voice playback as a product-facing companion system
- richer avatar model/render support beyond the current stylized shell
- intentional desktop-hover or attach-to-window behavior
- a stronger embodied presence outside the current workspace framing

## Scope

Milestone 3 should include:

- voice as a base product system, not an optional add-on
- an avatar system that can grow beyond the current fallback shell into richer
  character models
- local user-imported custom packs as a first-class path for voice, avatar, and
  personality identity
- more deliberate desktop embodiment behavior
- stronger overlay/pinned presence behavior on Windows

Milestone 3 should **not** include:

- stream/creator expansion
- marketplace depth
- new core action families
- many-character ecosystem work
- mobile
- heavy autonomy or agent orchestration

## Execution Style

Use fewer, larger vertical slices than Milestone 2.

Preferred slice size:

- one real system improvement per branch
- desktop shell + runtime + tests together when needed
- avoid opening a PR for every tiny copy or spacing tweak

Each slice should still:

- preserve the one persistent companion rule
- keep Windows stable
- stay local-first
- remain reviewable

## Slice Order

### Slice 1: Voice Foundation

Goal:
Make voice a real system instead of dormant pack metadata.

Include:

- define the default local voice playback path
- connect pack voice metadata to an actual runtime/UI flow
- establish clear voice-ready, voice-muted, and voice-unavailable states
- keep voice optional and user-controlled
- keep the system ready for local user-imported voice packs

Acceptance criteria:

- the active pack can expose a usable voice identity
- the desktop shell can reflect voice readiness
- voice can be turned off without breaking the companion flow
- failure states remain companion-like, not technical

### Slice 2: Avatar System Upgrade

Goal:
Move from one fallback avatar shell toward a reusable avatar/character layer.

Include:

- formalize how packs choose avatar presentation
- support a richer avatar asset path beyond simple icon/config metadata,
  including future 3D-ready character presentation
- keep the current fallback avatar as the safe baseline
- define how state animations map onto future avatar models
- make local user-imported character packs part of the intended system design

Acceptance criteria:

- avatar rendering has a clear contract for fallback vs richer pack visuals
- the default experience still works without custom assets
- pack-specific visual identity becomes a first-class part of embodiment

### Slice 3: Desktop Presence Behavior

Goal:
Make the companion feel more like an on-screen presence than a fixed workspace
character.

Include:

- window placement and presence rules for normal desktop use
- better pinned/overlay behavior on Windows
- early forms of “nearby” behavior such as stronger floating or anchored stage
  presence
- user-control boundaries for always-on-top and click-through behavior

Acceptance criteria:

- the companion can remain visibly present without harming core usability
- overlay behavior feels intentional and reversible
- the companion still reads as the same identity, not a separate overlay mode

### Slice 4: Attachment And Window Affinity

Goal:
Begin the “sits on the desktop / near windows” fantasy in a controlled way.

Include:

- first pass at attachment or affinity behavior for windowed applications
- visible rules for when the companion floats, pins, or attaches
- graceful fallback when the platform cannot provide exact attachment behavior

Acceptance criteria:

- the companion can feel spatially related to the desktop or an active window
- behavior is understandable and does not feel buggy or random
- performance and pointer interaction remain acceptable

## Recommended Branch Strategy

Use milestone branches like this:

1. `codex/m3-voice-foundation`
2. `codex/m3-avatar-system`
3. `codex/m3-desktop-presence`
4. `codex/m3-window-affinity`

Do not branch by layer only.

Bad:

- “all runtime voice work”
- “all frontend embodiment work”

Better:

- one end-to-end slice per user-facing capability jump

## Validation Expectations

Minimum for each Milestone 3 slice:

```powershell
cd C:\Users\Grand\Downloads\companion-os\services\agent-runtime
.\.venv\Scripts\python -m pytest -q

cd C:\Users\Grand\Downloads\companion-os\apps\desktop
npm run test -- --run
npm run lint
npm run build

cd C:\Users\Grand\Downloads\companion-os\apps\desktop\src-tauri
cargo check --locked
```

Additional validation when embodiment behavior changes:

- manual Windows desktop smoke pass
- overlay/pin/click-through behavior check
- packaging sanity if desktop shell startup changes

## Risks To Watch

- letting voice become mandatory instead of companion-enhancing
- introducing separate “voice mode” or “overlay mode” behavior
- overbuilding avatar tech before the product feel is validated
- harming normal desktop usability with aggressive always-on-top behavior
- letting stream/creator features creep back into the milestone

## Definition Of Done

Milestone 3 is done when:

- the companion has a believable early voice foundation
- avatar presentation has a scalable system behind it
- the desktop presence feels more embodied than “chat window with avatar”
- Windows users can feel the beginning of hover / attach / on-screen life
  without the product becoming unstable or intrusive

## Product Rule For This Milestone

Milestone 3 should treat these as base product systems:

- voice
- avatar and character presentation
- personality pack identity
- local user-imported custom packs

The shipped defaults should remain stable and maintainable, but the product
should be built so users can make the companion feel personal through local
pack imports rather than treating customization as an afterthought.

## Working Rule

Milestone 3 should still optimize for the same north star:

> Companion OS should feel like a real companion with useful powers, not a
> useful tool with a face.
