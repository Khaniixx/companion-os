# Companion OS

Companion OS is an open‑source project to build a **persistent AI companion** that lives on your desktop, helps you with real tasks, reacts contextually and performs on stream.  The project unifies an agentic backend with an embodied character interface so you get one identity that adapts to different contexts—coding, gaming, streaming or casual use—without switching modes.

## Vision

Companion OS aims to be the next step beyond traditional AI assistants.  Instead of a faceless chatbot or a simple desktop pet, it provides a presence that:

* **Exists visually on your screen** – sits on windows, reacts to your actions and displays progress while working.
* **Performs real work** – built on an agentic core inspired by OpenClaw, it can open apps, browse the web, scaffold projects, summarise files and automate workflows.
* **Learns you** – remembers habits, preferences and repeated workflows while respecting privacy.  Memory is summarised rather than storing everything and is always editable.
* **Entertains on stream** – integrates with OBS and Twitch/YouTube chat to provide subtle reactions, text bubbles and occasional one‑liners when you’re live.
* **Is customisable** – supports modular skills and community‑contributed abilities, plus optional personality packs, outfits and role‑play modes.

## Project Structure

```
companion-os/
├── README.md               # this file
├── apps/                   # frontend and desktop shells
│   ├── desktop/            # Tauri desktop app
│   │   ├── src/            # React/TypeScript source code
│   │   ├── src-tauri/      # Rust backend for Tauri commands
│   │   └── package.json    # Desktop app manifest
│   └── web-admin/          # Placeholder for future admin UI
├── services/               # backend services
│   ├── agent-runtime/      # Python FastAPI service for agent orchestration
│   │   ├── app/
│   │   │   ├── api/        # REST interfaces
│   │   │   ├── core/       # core agent loop & planning
│   │   │   ├── tools/      # skill wrappers (filesystem, browser, etc.)
│   │   │   ├── memory/     # memory schemas and summarisation
│   │   │   ├── reactions/  # event–reaction mapping
│   │   │   └── skills/     # built‑in skills
│   │   └── pyproject.toml  # Python build metadata
│   └── media-worker/       # placeholder for future media processing
├── packages/               # shared packages
│   ├── ui/                 # reusable UI components
│   ├── shared-types/       # event & API type definitions
│   ├── prompt-kits/        # templated system prompts
│   ├── character-engine/   # personality & animation state machine
│   ├── skill-sdk/          # developer SDK for building skills
│   └── config/             # centralised configuration values
├── skills/                 # skill repository
│   ├── official/           # first party skills
│   │   ├── app-launcher/
│   │   │   ├── SKILL.md    # manifest describing skill metadata & permissions
│   │   │   └── handlers/   # implementation code
│   │   └── browser-helper/
│   │       ├── SKILL.md
│   │       └── handlers/
│   └── community-imports/  # imported third‑party skills (empty by default)
├── docs/                   # documentation
│   ├── product/            # high-level product docs
│   ├── engineering/        # technical architecture and ADRs
│   ├── api/                # API docs
│   ├── skills/             # skill development guides
│   └── prompts/            # prompt design docs
├── .github/                # GitHub settings & workflows
│   ├── workflows/          # CI definitions
│   ├── ISSUE_TEMPLATE/     # GitHub issue templates
│   ├── PULL_REQUEST_TEMPLATE.md # PR template
│   └── CODEOWNERS          # repository ownership
└── LICENSE                 # license (to be decided)
```

## Contributing

Companion OS welcomes contributions!  See the `CONTRIBUTING.md` file (to be created) for guidelines on how to get started.  In short:

1. Fork the repository and create a feature branch.
2. Make your changes following the coding standards described in `docs/engineering`.
3. Open a pull request with a clear description of your changes.
4. Ensure that your PR passes all CI checks and includes relevant tests.

## Desktop Installation Flow

The desktop onboarding flow should remain consistent across product and implementation work:

1. Environment Check
2. Prepare Prerequisites
3. Install OpenClaw
4. Configure AI using a local, openâ€‘source model by default
5. Start & Connect

Core features should work without requiring API keys during this default path.

The installer is expected to be resumable and product-safe:

- Save installer progress locally so a restart resumes from the current step instead of starting over.
- Detect Node.js, Rust, the Windows C++ / MSVC toolchain, and the local model runtime dependencies required for OpenClaw.
- Attempt silent setup where it is reliable, and switch to guided repair steps with exact next actions when manual intervention is needed.
- Show clear per-step states for pending, active, complete, failed, and needs action.
- Reopen directly into the companion when setup is already complete.

## MVP Local Model Flow

The MVP chat path is local-first:

- Companion replies are generated through a backend provider abstraction instead of the temporary echo route.
- The default provider path is a free local open-source model running through Ollama.
- The recommended first-run model is `llama3.1:8b-instruct`, and it is selected automatically unless the user chooses a different supported local model during setup.
- The selected model is stored in backend preferences so installer setup, runtime chat, and future restarts stay aligned.
- If the local model runtime is still loading or the model has not been pulled yet, the companion returns a graceful fallback reply instead of a raw backend error.

## MVP Action Skills

The first MVP action skills use explicit permissions and companion-style confirmations:

- `open_app` launches supported desktop apps such as Spotify after user confirmation.
- `browser-helper` can handle `search for <query>` and `open <url>` by opening the default browser after the user grants browser access.

## MVP Command Routing

Incoming companion messages use a minimal router rather than a planner:

- `open Spotify` and `open Discord` route to `app-launcher`
- `search for <query>` routes to `browser-helper`
- browser-like `open <url>` messages can route to `browser-helper`
- everything else falls back to normal companion chat

The router returns a structured result with the chosen route, the user message, the companion reply, and optional action metadata so the desktop shell can keep one seamless conversation.

### Developing Skills

Skills extend the agent’s abilities by wrapping functionality behind a stable interface.  Each skill lives in its own folder under `skills/` and contains a `SKILL.md` manifest specifying metadata (name, description, allowed actions) and any code required to implement it.  Companion OS is compatible with OpenClaw‑style skills, but all community skills must declare permissions and pass a security review before distribution.

For more details, see `docs/skills/creating-skills.md` (to be written).

## License

This project is currently provided for educational and prototyping purposes.  An appropriate open‑source license will be selected as the project matures.
