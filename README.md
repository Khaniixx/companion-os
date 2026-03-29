# Companion OS

Companion OS is an open‑source project to build a **persistent AI companion** that lives on your desktop, helps you with real tasks, reacts contextually and performs on stream.  The project unifies an agentic backend with an embodied character interface so you get one identity that adapts to different contexts—coding, gaming, streaming or casual use—without switching modes.

## Current Release Scope

Companion OS is currently a Windows-first desktop MVP.

- Windows is the only release target we actively package and validate right now.
- macOS and Linux are experimental targets in the current branch. They remain under validation and are not release-ready.
- The Linux GTK/WebKit dependency chain is still tracked because Tauri/Wry transitively resolves `glib 0.18.5`, so cross-platform packaging remains intentionally deferred until that upstream path improves and real machine validation is complete.

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

Companion OS welcomes contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to get started. In short:

1. Fork the repository and create a feature branch.
2. Make your changes following the coding standards described in `docs/engineering`.
3. Open a pull request with a clear description of your changes.
4. Ensure that your PR passes all CI checks and includes relevant tests.

## Testing

The MVP expects both runtime and desktop coverage for shipped features:

- Backend unit and integration coverage uses `pytest` plus `fastapi.testclient`.
- Desktop unit and interaction coverage uses Vitest plus React Testing Library.
- When a feature changes behavior, update both the tests and the relevant docs in the same slice.

Useful local commands:

- `cd services/agent-runtime && .\.venv\Scripts\python -m pytest`
- `cd apps/desktop && npm run test -- --run`
- `cd apps/desktop && npm run lint`
- `cd apps/desktop && npm run build`

Feature-specific docs live under [docs/README.md](./docs/README.md).

## Platform Requirements

The current desktop MVP is documented and validated as a Windows release:

- Supported release target: Windows 10 22H2 or Windows 11.
- Required runtime/platform pieces: WebView2 runtime and Visual Studio 2022 Build Tools with the C++ workload for local Rust/Tauri builds.
- Experimental targets: macOS and Linux. Keep them under explicit validation and upstream tracking until packaging and runtime behavior are confirmed on real machines.

Minimum hardware guidance for a local-model-first setup:

- CPU: 4 modern cores minimum, 8 recommended.
- Memory: 8 GB RAM minimum for the desktop shell, 16 GB recommended for local models.
- Storage: 10 GB free minimum, 25 GB recommended when pulling local model weights.
- GPU: optional for the companion shell itself, but local-model performance improves substantially with supported acceleration.

## Packaging And Security

The repository now treats dependency and packaging checks as part of the shipped product, not optional maintenance:

- CI runs `npm audit` for the desktop frontend.
- CI runs `cargo audit` against the locked Tauri dependency graph.
- CI validates Tauri bundle creation for the current Windows release target through a dedicated packaging workflow.
- macOS and Linux packaging remain experimental and tracked, but they are not release gates in the current branch.

One upstream Rust advisory remains tracked:

- `RUSTSEC-2024-0429` affects `glib < 0.20.0`.
- The current desktop lockfile still resolves `glib 0.18.5` through the Linux Tauri stack:
  `tauri 2.10.3 -> tauri-runtime-wry 2.10.1 -> wry 0.54.4 -> webkit2gtk 2.0.2 -> gtk 0.18.2 -> glib 0.18.5`
- The repository now documents that path explicitly in [audit.toml](./apps/desktop/src-tauri/audit.toml). Remove the temporary ignore as soon as the upstream Tauri/Wry GTK stack moves to `glib >= 0.20.0`.

## Installation Troubleshooting

If local installation or packaging fails, these are the first checks to make:

- `link.exe not found` on Windows:
  Install Visual Studio 2022 Build Tools and include the C++ workload (`Microsoft.VisualStudio.Workload.VCTools`). A plain Rust install is not enough for the `x86_64-pc-windows-msvc` target.
- `cargo audit` cannot run locally on Windows:
  This usually points to the same missing MSVC toolchain. Run it from a Developer Command Prompt or use the CI audit job until the local machine is configured.
- Transparent overlay looks wrong:
  Update GPU drivers, confirm desktop transparency is enabled, and test with the active compositor or window manager. Some Linux environments may flatten transparency or shadow behavior differently.
- Local chat model is missing or unavailable:
  Reopen the installer or settings surface, select an available local model, and make sure Ollama is installed and the selected model has been pulled locally.

Future platform note:

- Linux and macOS packaging issues should be tracked separately from the Windows release path until those experimental targets are promoted into the supported release matrix.

## Desktop Installation Flow

The desktop onboarding flow should remain consistent across product and implementation work:

1. Download
2. Install OpenClaw
3. Configure AI using a local, open-source model by default
4. Start & Connect

Core features should work without requiring API keys during this default path.

The installer is expected to be resumable and product-safe:

- Save installer progress locally so a restart resumes from the current step instead of starting over.
- Detect Node.js, Rust, the Windows C++ / MSVC toolchain where required, and the local model runtime dependencies required for OpenClaw.
- Attempt silent setup where it is reliable, and switch to guided repair steps with exact next actions when manual intervention is needed.
- Show clear per-step states for pending, active, complete, failed, and needs action.
- Stop safely on timeouts or installer hangs, then expose clear Retry and Repair paths instead of leaving the user stranded.
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

## MVP Personality Packs

The desktop shell now supports local personality packs without breaking the core rule of one persistent companion:

- Packs install from signed zip archives that include `pack.json` plus local assets such as icons, VRM/FBX files, and audio cues.
- The runtime validates the manifest schema, rejects unsupported capabilities, verifies the manifest signature, and checks per-asset SHA-256 hashes before a pack is installed.
- Installed packs are stored locally and can be listed or switched from the desktop settings surface.
- Tavern Card V2/V3 PNGs can be imported through the runtime conversion tool, which maps known card fields into the pack format and stores unknown fields under `extensions`.
- The active pack is persisted locally so the companion reopens with the same selected identity on restart.

## MVP Curated Marketplace

The curated marketplace is a catalog surface inside the same companion settings flow, not a separate store mode:

- The runtime serves curated listings for personality packs and skills with metadata for name, description, version, required capabilities, price label, publisher signature, and creator revenue share.
- Personality-pack listings must include a content rating and an IP declaration before they can be shown as installable.
- Moderation metadata combines automated scans such as malware, capability, content, and license checks with a manual review record.
- The desktop app clearly labels free versus paid listings and keeps all core companion functionality free.
- In the MVP, approved free personality packs can be installed directly from the curated catalog, while paid listings and skill listings remain browse-only until checkout and skill distribution are ready.

## MVP Memory & Privacy

The runtime now keeps long-term memory local and summarized by default:

- Conversation history is condensed into local summaries instead of storing every raw chat message forever.
- Long-term memory can be disabled completely from the desktop settings surface.
- Summary cadence is user-controlled and defaults to a local summary every 25 messages.
- Saved summaries can be viewed, edited, and deleted from the desktop app.
- Cloud backup remains opt-in only. The MVP stores memory locally on the device unless the user explicitly changes that privacy setting.

## MVP Command Routing

Incoming companion messages use a minimal router rather than a planner:

- `open Spotify` and `open Discord` route to `app-launcher`
- `search for <query>` routes to `browser-helper`
- browser-like `open <url>` messages can route to `browser-helper`
- everything else falls back to normal companion chat

The router returns a structured result with the chosen route, the user message, the companion reply, and optional action metadata so the desktop shell can keep one seamless conversation.

## MVP Micro-Utilities

The first companion-side utility set is now local, quiet, and conversation-driven:

- Timers and alarms can be created from messages such as `set a 5 minute timer` or `set an alarm for 7:30 pm`.
- Reminders and to-do notes can be added from natural requests such as `remind me to stretch in 10 minutes` and `add todo buy milk`.
- Clipboard history stays local and can be captured through `save clipboard`, with the desktop shell reading the clipboard and sending only the current text to the local runtime.
- Quick-launch shortcuts are exposed as first-party utilities so the companion can run saved actions such as Spotify or a browser search without breaking the single-conversation flow.
- Successful utility actions refresh the desktop "Desk" surface and briefly move the character state machine into a `reaction` state instead of interrupting the user with intrusive UI.

## MVP Stream & Overlay Integration

The streaming layer remains part of the same companion rather than a separate streaming mode:

- The desktop shell can switch into a transparent overlay presentation so the companion can sit above the desktop and capture cleanly in OBS or Twitch scenes.
- Overlay click-through can be enabled for live use, while the companion still keeps an escape path back to interactive control.
- Stream integration settings are stored locally, including provider choice, overlay preferences, and which stream events should trigger reactions.
- The runtime can ingest supported Twitch EventSub webhook notifications for subscriptions and cheers.
- The runtime can ingest supported YouTube live events from a local relay or polling bridge, including new memberships and Super Chats.
- Recent stream events are stored locally and surfaced back to the desktop shell so the companion can show quick reaction bubbles without interrupting the main conversation flow.

### Developing Skills

Skills extend the agent’s abilities by wrapping functionality behind a stable interface.  Each skill lives in its own folder under `skills/` and contains a `SKILL.md` manifest specifying metadata (name, description, allowed actions) and any code required to implement it.  Companion OS is compatible with OpenClaw‑style skills, but all community skills must declare permissions and pass a security review before distribution.

For more details, see `docs/skills/creating-skills.md` (to be written).

## License

Companion OS is available under the [MIT License](./LICENSE).
