# Reference Adoption Plan

This document captures which external projects and open-source components are
worth borrowing from for Companion OS, and how they should influence current
implementation work.

The goal is not to turn Companion OS into a clone of another project.

The goal is to use proven open-source building blocks where they materially
speed up the product while preserving the Companion OS product rules:

- one persistent companion identity
- local-first defaults where practical
- user control over voice, presence, and model behavior
- voice, avatar, embodiment, and custom packs as core product systems

## Why This Exists

Recent reference work showed a pattern across the strongest companion projects:

- they do not build everything from scratch
- they use focused external components for rendering, speech, and integrations
- they keep product identity separate from the underlying implementation pieces

This document makes that strategy explicit so future work can move faster and
stay consistent.

## Adoption Rules

Use external work when it helps us ship faster in a bounded area.

Prefer:

- small focused libraries
- renderer-specific adapters
- speech or VAD components with clear boundaries
- integration patterns that do not force a different product identity

Avoid:

- copying entire app architectures wholesale
- importing large agent frameworks before the desktop companion loop is strong
- streamer-first assumptions that distort the desktop companion product
- dependencies that make local-first defaults harder without a clear user win

## Take Now

These are the highest-value references for current Milestone 3 work.

### Open-LLM-VTuber

Reference:

- [Open-LLM-VTuber/Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)

Take now:

- live voice loop ideas
- voice interruption behavior
- transparent desktop-pet presence
- Live2D-first embodiment patterns
- secure-context awareness for microphone input

Use this reference for:

- tighter listening and speaking flow
- richer desktop-presence behavior
- Live2D runtime expectations

### AIRI

Reference:

- [moeru-ai/airi](https://github.com/moeru-ai/airi)

Take now:

- separation between speech input, speech output, and renderer layers
- Live2D and VRM adapter boundaries
- lip-sync, blink, look-at, and idle-eye-motion concepts
- pack-driven character settings

Use this reference for:

- renderer contracts
- model manifest evolution
- embodiment system design

### amica

Reference:

- [semperai/amica](https://github.com/semperai/amica)

Take now:

- VRM pipeline direction
- 3D renderer structure
- emotion or state-driven avatar behavior

Use this reference for:

- the first serious VRM-ready adapter path

## Take Soon

These are useful once the current embodiment loop is stronger.

### eliza

Reference:

- [elizaOS/eliza](https://github.com/elizaOS/eliza)

Take soon:

- connector patterns
- plugin and extension boundaries
- provider-agnostic integration discipline
- examples of integrating agents with external systems and APIs

Use this reference for:

- later Milestone 4 plugin and connector architecture
- integration boundaries that do not pollute the core companion identity

Do not take from it:

- product identity as a multi-agent platform
- framework bulk that does not improve the desktop companion directly

### z-waif

Reference:

- [SugarcaneDefender/z-waif](https://github.com/SugarcaneDefender/z-waif)

Take soon:

- local companion framing
- memory and lorebook ideas
- animation or emote mapping

Use this reference for:

- future memory depth
- pack personality and expression behavior

### Neuro

Reference:

- [kimjammer/Neuro](https://github.com/kimjammer/Neuro)

Take soon:

- practical realtime STT and TTS loop ideas
- local-model-first thinking
- lightweight control and moderation ideas

Use this reference for:

- tighter end-to-end companion responsiveness

## Component Shortlist

These are the types of open-source components we should be willing to adopt
instead of rebuilding from scratch.

### Renderer Components

Prioritize:

- Live2D runtime components such as `pixi-live2d-display`
- `pixi.js` for Live2D stage rendering
- `@pixiv/three-vrm` for VRM model support

Use these for:

- real renderer behavior beyond the current visual shell
- pack-driven model rendering
- future blink, mouth, and idle motion hooks

### Speech Components

Prioritize:

- browser speech recognition where practical
- local-first TTS and STT paths where practical
- voice activity detection components such as Silero-VAD-style browser paths

Use these for:

- hearing
- talking detection
- smoother voice loop behavior

### Lightweight AI SDKs

Shortlist:

- [moeru-ai/xsai](https://github.com/moeru-ai/xsai)

Potential use:

- optional OpenAI-compatible provider portability
- lightweight streaming and tool-call integrations

Not the current priority because:

- current Milestone 3 bottlenecks are embodiment and speech loop quality
- Companion OS should keep local-first defaults where practical
- another provider SDK does not move the current desktop product as much as
  renderer and speech improvements

## Current Priority Order

Use external work to accelerate these product goals in this order:

1. real Live2D runtime quality
2. tighter speech input and output loop
3. voice interruption and cleaner transition behavior
4. first VRM-ready adapter path
5. stronger local custom-pack readiness
6. plugin and connector architecture later

## Working Rule

When choosing between building and borrowing, prefer the option that:

- gets a believable companion experience into the app faster
- keeps system boundaries clean
- does not compromise the one persistent companion rule
- does not create unnecessary provider or framework lock-in

Companion OS should feel intentionally built, but it does not need to be
handmade at every layer.
