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

### Developing Skills

Skills extend the agent’s abilities by wrapping functionality behind a stable interface.  Each skill lives in its own folder under `skills/` and contains a `SKILL.md` manifest specifying metadata (name, description, allowed actions) and any code required to implement it.  Companion OS is compatible with OpenClaw‑style skills, but all community skills must declare permissions and pass a security review before distribution.

For more details, see `docs/skills/creating-skills.md` (to be written).

## License

This project is currently provided for educational and prototyping purposes.  An appropriate open‑source license will be selected as the project matures.