# Contributing To Companion OS

## Before You Start

Companion OS is centered on one persistent companion identity. Changes that
split the product into separate assistant "modes" for coding, gaming,
streaming, or casual use should not be proposed. The companion can change
state, presentation, and permissions, but it remains the same companion.

If your change touches onboarding or installation, preserve this sequence:

1. Download
2. Install OpenClaw
3. Configure AI
4. Start & Connect

UI work in that area must keep the active step, completed steps, and blocked
steps explicit.

## Development Environment

The current MVP is Windows-first. The repository also contains experimental
cross-platform work, but Windows is the only release target actively packaged
and validated today.

Recommended local tooling:

- Node.js 20
- npm
- Python 3.11
- Poetry
- Rust stable toolchain
- Visual Studio 2022 Build Tools with the C++ workload
- Microsoft WebView2 runtime

## Repository Layout

- `apps/desktop`: Tauri desktop shell with the React frontend
- `services/agent-runtime`: FastAPI-based runtime and tests
- `packages`: shared packages and contracts
- `skills`: first-party and community-imported skills
- `docs`: product, API, and engineering documentation

## Workflow

1. Fork the repository and create a focused branch for one change.
2. Keep changes small and runnable. Avoid mixing feature work with unrelated
   refactors.
3. Update tests and docs in the same slice when behavior changes.
4. Open a pull request with a clear summary, validation notes, and any known
   gaps.

## Coding Expectations

Follow the repo rules in `AGENTS.md` and existing local conventions.

For Python:

- Format with `black`.
- Prefer type hints for public interfaces.
- Keep FastAPI modules and service logic straightforward and explicit.

For TypeScript and React:

- Prefer strict typing over `any`.
- Keep UI state predictable and localized where practical.
- Reuse shared packages instead of duplicating types or config.

For all code:

- Preserve contracts between the desktop shell, runtime, shared types, and
  skills.
- Treat permissions, safety boundaries, and user control as first-class
  requirements.
- Add comments only when intent is not obvious from the code.
- Avoid speculative abstractions.

## Validation

Run the relevant automated checks before opening a pull request.

Desktop frontend:

```powershell
cd apps/desktop
npm ci
npm run lint
npm run test -- --run
npm run build
```

Python runtime:

```powershell
cd services/agent-runtime
python -m pip install --upgrade pip poetry
poetry install --no-interaction --no-root
poetry run pytest -q
poetry run python -m compileall app tests
```

If you change both surfaces, run both sets of checks. If a practical automated
test can be added, add it. If one cannot be added yet, call that gap out in the
pull request.

## Commits And Pull Requests

- Make focused commits with a single clear purpose.
- Use imperative commit messages, such as `Add runtime health endpoint`.
- Include screenshots for user-facing desktop changes when they help explain the
  result.
- Call out behavioral changes, migrations, and testing coverage in the pull
  request description.

## Security Reports

Do not open public issues for vulnerabilities, credential exposure, sandbox
escapes, or permission-boundary failures. Report those through the private
process described in [SECURITY.md](./SECURITY.md).
