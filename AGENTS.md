# AGENTS.md

## Purpose

This file defines the baseline contribution rules for Companion OS contributors and coding agents.

## Core Design Rule

Companion OS is built around one companion identity with different states and behaviors depending on context.

Do not introduce separate "modes" as if the product becomes a different assistant for coding, gaming, streaming, or casual use. The companion may shift state, presentation, permissions, or reactions, but it must remain the same persistent companion.

## Product Rules

- The installer must detect missing prerequisites and install them silently where possible, including Node.js and the Rust/C++ toolchain required for the desktop shell.
- Core features must default to local, open-source models. Do not require API keys for the primary product flow.
- The installation flow must follow this sequence exactly: Download -> Install OpenClaw -> Configure AI -> Start & Connect.
- The UI must reflect that installation flow with clear progress indicators and explicit state transitions so the user always knows what step is active, completed, or blocked.
- Preserve the one persistent companion principle throughout installation and onboarding. Setup may change the companion's state or readiness, but it must not introduce separate product modes.

## Coding Style

Use clear, maintainable code with small, composable units.

For Python:

- Format code with `black`.
- Prefer type hints for public interfaces.
- Keep FastAPI modules and service logic straightforward and explicit.

For TypeScript and React:

- Prefer strict typing over `any`.
- Keep UI state predictable and localized where practical.
- Reuse shared packages instead of duplicating types or config.

For all code:

- Match existing project structure and naming.
- Add comments only where intent is not obvious from the code.
- Avoid speculative abstractions until they are justified by real usage.

## Commit Guidelines

- Make focused commits with a single clear purpose.
- Write commit messages in imperative mood, for example `Add runtime health endpoint`.
- Do not mix unrelated refactors with feature work or bug fixes.
- Update documentation when behavior, contracts, or contributor workflows change.

## Test Requirements

- Run `pytest` before submitting changes.
- Add or update tests for behavior you change when the relevant test surface exists.
- Do not submit code that is untested if a practical automated test can be added.
- If a test cannot be added yet, note the gap clearly in the handoff or pull request.

## Working Expectations

- Preserve the contract between the desktop shell, runtime, shared types, and skills.
- Treat permissions, safety boundaries, and user control as first-class requirements.
- Prefer incremental, runnable steps over large unverified rewrites.
