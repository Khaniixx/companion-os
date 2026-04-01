# Milestone 3: Embodiment Reference

This document captures the current embodiment direction for Companion OS so it
does not live only in chat history or personal memory.

Use it alongside the Milestone 3 plan when deciding what to build next, what to
defer, and which external repos are worth borrowing from.

## Why This Exists

Milestone 3 is no longer just about making the current avatar shell prettier.

It is the phase where Companion OS should establish voice, avatar rendering,
desktop embodiment, and local custom pack support as real product systems.

This document exists to make three things explicit:

- the preferred agent workflow for larger Milestone 3 slices
- the embodiment capabilities we want to move toward
- the external references we can study or adapt without losing product focus

## Workflow Upgrades To Keep Using

When available in the coding environment, prefer these workflow skills and
patterns for Milestone 3 work:

- `systematic-debugging`
  Use for CI breakage, native/window regressions, type failures, and flaky
  embodiment behavior.
- `verification-before-completion`
  Use before handoff on slices that touch runtime, desktop shell, or native
  window behavior.
- `review-and-simplify-changes`
  Use on large diffs to reduce churn, improve reuse, and keep embodiment work
  maintainable.
- `orchestrate-batch-refactor`
  Use when a Milestone 3 change spans multiple layers and should be split into
  larger dependency-aware packets instead of tiny PRs.
- `project-skill-audit`
  Use later if Companion OS develops enough repeated workflows to justify more
  project-local skills.

These are workflow improvements, not product features.

## Embodiment Direction

Companion OS should move toward a more alive companion through three product
tracks:

### Ears

The companion should eventually support:

- browser audio input
- optional Discord audio input later
- client-side speech recognition where practical
- talking detection / voice activity detection

### Mouth

The companion should eventually support:

- real speech playback
- provider-backed speech synthesis
- local-first or user-controlled fallback paths where possible
- lip-sync hooks for richer avatar renderers

### Body

The companion should eventually support:

- richer avatar renderers beyond the fallback shell
- VRM support
- Live2D support
- model-specific idle, perch, attach, and speaking behavior
- auto blink
- auto look-at
- light idle eye movement
- model animation hooks

These are embodiment targets, not a requirement to ship every provider or
renderer at once.

## Product Rule For Adaptation

Companion OS should borrow these ideas without becoming a clone of another
project.

Keep these rules:

- one persistent companion identity
- local-first default path where practical
- user control over voice, presence, and model behavior
- local user-imported custom packs as a first-class path
- no forced dependency on one provider, one renderer, or one copyrighted
  character ecosystem

## AIRI: What Is Worth Adapting

Primary reference:

- [moeru-ai/airi](https://github.com/moeru-ai/airi)

Useful AIRI implementation surfaces:

- audio input and browser recording
  - `apps/stage-web/src/composables/audio-input.ts`
  - `apps/stage-web/src/composables/audio-record.ts`
- voice activity detection
  - `apps/stage-web/src/workers/vad/`
  - `apps/stage-pocket/src/workers/vad/`
- speech/runtime plumbing
  - `packages/pipelines-audio/`
  - `packages/audio-pipelines-transcribe/`
  - `packages/stage-ui/src/services/speech/`
- speech providers and settings
  - `packages/stage-pages/src/pages/settings/providers/speech/`
  - `packages/stage-pages/src/pages/settings/providers/transcription/`
  - includes `elevenlabs.vue`, browser speech API, and other provider adapters
- Live2D renderer path
  - `packages/stage-ui-live2d/`
- VRM renderer path
  - `packages/stage-ui-three/`
  - `packages/model-driver-lipsync/`
  - `packages/model-driver-mediapipe/`

What to take from AIRI:

- renderer adapters should be separated cleanly from core companion logic
- speech input, speech output, and avatar animation should each have their own
  system boundary
- richer model renderers need explicit hooks for idle, talking, blinking,
  look-at, and expression control
- model and voice settings should be pack-driven, not hardcoded into one shell

What not to copy directly:

- the VTuber/waifu framing
- platform sprawl before the desktop product is stable
- a giant provider matrix before we validate the local-first default path

## Other References

Workflow and coding-agent references:

- [obra/superpowers](https://github.com/obra/superpowers)
  Good workflow reference for debugging, verification, and larger plan
  execution.
- [Dimillian/Skills](https://github.com/Dimillian/Skills)
  Good reference for change review, simplification, and large refactor
  execution.

Architecture references:

- [volcengine/OpenViking](https://github.com/volcengine/OpenViking)
  Good conceptual reference for context and memory organization.
  Treat this as architecture inspiration only. Do not copy code casually because
  it is AGPL-3.0 licensed.
- [bytedance/deer-flow](https://github.com/bytedance/deer-flow)
  Good later reference for harness/sub-agent orchestration, not an immediate
  dependency for the product.

## Recommended Near-Term Build Order

After the current attachment-target work, prefer this order:

1. pack-driven model manifest support
2. speech input foundation
3. speech output foundation
4. renderer adapter contract for `shell | live2d | vrm`
5. first richer renderer path
6. lip-sync / blink / look-at hooks

This keeps the product moving toward a more alive companion without exploding
scope all at once.
