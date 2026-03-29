import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanionWorkspace } from "./CompanionWorkspace";

function createInstallerStatus(
  overrides?: Partial<{ completed: boolean; model: string }>,
) {
  return {
    current_step: "complete",
    completed: overrides?.completed ?? true,
    environment: {
      checks: [],
      node_installed: true,
      rust_installed: true,
      cpp_toolchain_installed: true,
      runtime_dependencies_ready: true,
      missing_prerequisites: [],
      missing_runtime_dependencies: [],
      all_ready: true,
    },
    steps: {
      download: {
        id: "download",
        title: "Download",
        description: "",
        status: "complete",
        message: "",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
      "install-openclaw": {
        id: "install-openclaw",
        title: "Install OpenClaw",
        description: "",
        status: "complete",
        message: "",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
      "configure-ai": {
        id: "configure-ai",
        title: "Configure AI",
        description: "",
        status: "complete",
        message: "",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
      "start-connect": {
        id: "start-connect",
        title: "Start & Connect",
        description: "",
        status: "complete",
        message: "",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
    },
    openclaw: {
      installed: true,
      install_path: "C:/openclaw",
      manifest_path: "C:/openclaw/openclaw.json",
    },
    ai: {
      provider: "local",
      model: overrides?.model ?? "llama3.1:8b-instruct",
    },
    connection: {
      connected: true,
      message: "Companion OS is running on the local OpenClaw runtime.",
    },
  };
}

function createFetchMock(
  options?: Partial<{
    modelStatus: {
      provider: string;
      model: string;
      state: "ready" | "loading" | "missing";
      present: boolean;
      loaded: boolean;
      message: string;
    };
  }>,
) {
  let openAppGranted = false;
  let openUrlGranted = false;
  let nextUtilityId = 3;
  let nextStreamEventId = 20;
  let selectedModel = "llama3.1:8b-instruct";
  const utilityState = {
    timers: [] as Array<{
      id: number;
      kind: string;
      label: string;
      due_at: string | null;
      completed: boolean;
      created_at: string;
      updated_at: string;
      fired_at: string | null;
      dismissed: boolean;
    }>,
    reminders: [] as Array<{
      id: number;
      kind: string;
      label: string;
      due_at: string | null;
      completed: boolean;
      created_at: string;
      updated_at: string;
      fired_at: string | null;
      dismissed: boolean;
    }>,
    todos: [
      {
        id: 1,
        kind: "todo",
        label: "Keep setup notes tidy",
        due_at: null,
        completed: false,
        created_at: "2026-03-29T00:00:00+00:00",
        updated_at: "2026-03-29T00:00:00+00:00",
        fired_at: null,
        dismissed: false,
      },
    ],
    notes: [] as Array<{
      id: number;
      kind: string;
      label: string;
      due_at: string | null;
      completed: boolean;
      created_at: string;
      updated_at: string;
      fired_at: string | null;
      dismissed: boolean;
    }>,
    alerts: [] as Array<{
      id: number;
      kind: string;
      label: string;
      due_at: string | null;
      completed: boolean;
      created_at: string;
      updated_at: string;
      fired_at: string | null;
      dismissed: boolean;
    }>,
    clipboard_history: [] as Array<{
      id: number;
      text: string;
      created_at: string;
    }>,
    shortcuts: [
      {
        id: "spotify",
        label: "Spotify",
        kind: "app",
        target: "spotify",
      },
      {
        id: "discord",
        label: "Discord",
        kind: "app",
        target: "discord",
      },
      {
        id: "local-setup",
        label: "Local Setup Search",
        kind: "browser",
        target: "search for Companion OS local setup",
      },
    ],
  };
  const streamState = {
    settings: {
      enabled: false,
      provider: "twitch",
      overlay_enabled: false,
      click_through_enabled: false,
      twitch_channel_name: "",
      twitch_webhook_secret: "",
      youtube_live_chat_id: "",
      reaction_preferences: {
        new_subscriber: true,
        donation: true,
        new_member: true,
        super_chat: true,
      },
    },
    recent_events: [] as Array<{
      id: number;
      provider: string;
      type: string;
      actor_name: string;
      amount_display: string | null;
      message: string | null;
      bubble_text: string;
      created_at: string;
      should_react: boolean;
    }>,
  };
  let modelStatus =
    options?.modelStatus ?? {
      provider: "ollama",
      model: selectedModel,
      state: "ready" as const,
      present: true,
      loaded: true,
      message: "Your local model is awake and ready.",
    };
  utilityState.notes = [...utilityState.todos];

  const fetchMock = vi
    .spyOn(window, "fetch")
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/preferences/permissions/open_app")) {
        if (init?.method === "PUT") {
          openAppGranted = Boolean(JSON.parse(String(init.body)).granted);
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({ permission: "open_app", granted: openAppGranted }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/preferences/permissions/open_url")) {
        if (init?.method === "PUT") {
          openUrlGranted = Boolean(JSON.parse(String(init.body)).granted);
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({ permission: "open_url", granted: openUrlGranted }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/utilities/state")) {
        return Promise.resolve(
          new Response(JSON.stringify(utilityState), { status: 200 }),
        );
      }

      if (url.match(/\/api\/utilities\/items\/\d+$/) && init?.method === "PATCH") {
        const noteId = Number(url.split("/").pop());
        const body = JSON.parse(String(init.body)) as {
          label?: string;
          completed?: boolean;
        };
        const note = utilityState.notes.find((item) => item.id === noteId);
        if (!note) {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: "Note not found" }), {
              status: 400,
            }),
          );
        }

        if (body.label !== undefined) {
          note.label = body.label;
        }
        if (body.completed !== undefined) {
          note.completed = body.completed;
        }
        note.updated_at = "2026-03-29T03:00:00+00:00";
        if (note.kind === "todo") {
          const todo = utilityState.todos.find((item) => item.id === noteId);
          if (todo) {
            Object.assign(todo, note);
          }
        }
        if (note.kind === "reminder") {
          const reminder = utilityState.reminders.find((item) => item.id === noteId);
          if (reminder) {
            Object.assign(reminder, note);
          }
        }
        return Promise.resolve(
          new Response(JSON.stringify(note), { status: 200 }),
        );
      }

      if (
        url.match(/\/api\/utilities\/items\/\d+\/dismiss$/) &&
        init?.method === "POST"
      ) {
        const urlParts = url.split("/");
        const noteId = Number(urlParts[urlParts.length - 2]);
        const alert = utilityState.alerts.find((item) => item.id === noteId);
        if (!alert) {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: "Timer or alarm not found" }), {
              status: 400,
            }),
          );
        }
        alert.completed = true;
        alert.dismissed = true;
        utilityState.alerts = utilityState.alerts.filter((item) => item.id !== noteId);
        const timer = utilityState.timers.find((item) => item.id === noteId);
        if (timer) {
          timer.completed = true;
          timer.dismissed = true;
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              item: timer ?? alert,
              message: "I tucked that alert away for you.",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/utilities/clipboard/capture")) {
        const body = JSON.parse(String(init?.body)) as { text: string };
        const entry = {
          id: nextUtilityId,
          text: body.text,
          created_at: "2026-03-29T02:00:00+00:00",
        };
        nextUtilityId += 1;
        utilityState.clipboard_history.unshift(entry);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...entry,
              message: "I saved that clipboard text into your local history.",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/stream/state")) {
        return Promise.resolve(
          new Response(JSON.stringify(streamState), { status: 200 }),
        );
      }

      if (url.endsWith("/api/stream/events")) {
        if (init?.method === "DELETE") {
          const deleted = streamState.recent_events.length;
          streamState.recent_events = [];
          return Promise.resolve(
            new Response(JSON.stringify({ deleted }), { status: 200 }),
          );
        }

        return Promise.resolve(
          new Response(JSON.stringify(streamState.recent_events), { status: 200 }),
        );
      }

      if (url.endsWith("/api/stream/settings")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        streamState.settings = {
          ...streamState.settings,
          ...body,
          reaction_preferences: {
            ...streamState.settings.reaction_preferences,
            ...((body.reaction_preferences as Record<string, boolean> | undefined) ??
              {}),
          },
        };
        if (!streamState.settings.overlay_enabled) {
          streamState.settings.click_through_enabled = false;
        }
        return Promise.resolve(
          new Response(JSON.stringify(streamState.settings), { status: 200 }),
        );
      }

      if (url.endsWith("/api/stream/events/preview")) {
        const body = JSON.parse(String(init?.body)) as { type: string };
        const event = {
          id: nextStreamEventId,
          provider: body.type === "super_chat" ? "youtube" : streamState.settings.provider,
          type: body.type,
          actor_name: body.type === "donation" ? "Mika" : "Ari",
          amount_display:
            body.type === "donation" || body.type === "super_chat"
              ? "$5.00"
              : null,
          message: null,
          bubble_text:
            body.type === "donation"
              ? "Mika just sent $5.00."
              : body.type === "super_chat"
                ? "Ari sent a Super Chat for $5.00."
                : "Ari just subscribed on Twitch.",
          created_at: "2026-03-29T02:30:00+00:00",
          should_react: true,
        };
        nextStreamEventId += 1;
        streamState.recent_events.unshift(event);
        return Promise.resolve(
          new Response(JSON.stringify(event), { status: 200 }),
        );
      }

      if (url.endsWith("/api/installer/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(createInstallerStatus({ model: selectedModel })),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/installer/models")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              "llama3.1:8b-instruct",
              "mistral-small:24b-instruct",
              "qwen2.5-coder:7b-instruct",
            ]),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/installer/configure-ai")) {
        const body = JSON.parse(String(init?.body)) as { model: string };
        selectedModel = body.model;
        modelStatus = {
          provider: "ollama",
          model: selectedModel,
          state: "missing",
          present: false,
          loaded: false,
          message:
            `I am softly missing my local model, ${selectedModel}. ` +
            "Open settings to choose another local model or download this one first.",
        };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              provider: "local",
              model: selectedModel,
              message: "Saved your preferred local model.",
              step: {
                id: "configure-ai",
                title: "Configure AI",
                description: "",
                status: "complete",
                message: "Local AI is configured.",
                error: null,
                recovery_instructions: [],
                can_retry: false,
                can_repair: false,
              },
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/chat/model-status")) {
        return Promise.resolve(
          new Response(JSON.stringify(modelStatus), { status: 200 }),
        );
      }

      if (url.endsWith("/api/installer/install-openclaw")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              install_path: "C:/openclaw",
              message: "OpenClaw prepared locally at C:/openclaw.",
              step: {
                id: "install-openclaw",
                title: "Install OpenClaw",
                description: "",
                status: "complete",
                message:
                  "OpenClaw is installed locally and ready for model configuration.",
                error: null,
                recovery_instructions: [],
                can_retry: false,
                can_repair: false,
              },
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/installer/start-connect")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              connected: true,
              message: "Companion runtime is ready. Start & Connect completed.",
              step: {
                id: "start-connect",
                title: "Start & Connect",
                description: "",
                status: "complete",
                message:
                  "The companion is connected and ready in the desktop shell.",
                error: null,
                recovery_instructions: [],
                can_retry: false,
                can_repair: false,
              },
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/packs")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              active_pack_id: "sunrise-companion",
              schema_version: "1.0",
              packs: [
                {
                  id: "sunrise-companion",
                  name: "Sunrise Pack",
                  version: "1.0.0",
                  display_name: "Sunrise",
                  author_name: "Companion Labs",
                  license_name: "MIT",
                  content_rating: {
                    minimum_age: 13,
                    maximum_age: null,
                    tags: ["friendly"],
                  },
                  required_capabilities: [
                    {
                      id: "overlay.render",
                      justification: "Show the companion on screen.",
                    },
                  ],
                  optional_capabilities: [],
                  active: true,
                  icon_data_url: null,
                  installed_at: "2026-03-29T00:00:00+00:00",
                  system_prompt: "Stay warm, grounded, and practical.",
                  style_rules: [
                    "Keep one persistent companion identity.",
                    "Use calm phrasing.",
                  ],
                  voice: {
                    provider: "local",
                    voice_id: "sunrise",
                    locale: "en-US",
                    style: "warm",
                  },
                  avatar: {
                    idle_animation: "sunrise-idle",
                    listening_animation: "sunrise-listening",
                    thinking_animation: "sunrise-thinking",
                    talking_animation: "sunrise-talking",
                    reaction_animation: "sunrise-reaction",
                    audio_cues: {
                      talking: "voice/sunrise-talk.ogg",
                    },
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/marketplace/listings")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              schema_version: "1.0",
              listings: [
                {
                  schema_version: "1.0",
                  id: "bloom-starter-pack",
                  kind: "personality_pack",
                  name: "Bloom Starter Pack",
                  description: "A calm starter pack for the local companion.",
                  version: "1.0.0",
                  publisher: {
                    id: "companion-labs",
                    name: "Companion Labs",
                    website: "https://companion-os.local",
                    signature_key_id: "curated-marketplace-rs256",
                  },
                  license: {
                    name: "CC-BY-4.0",
                    spdx_identifier: "CC-BY-4.0",
                    url: null,
                  },
                  required_capabilities: [
                    {
                      id: "overlay.render",
                      justification: "Render the active companion on screen.",
                    },
                  ],
                  optional_capabilities: [],
                  price: {
                    is_free: true,
                    amount: null,
                    currency: null,
                    label: "Free",
                  },
                  revenue_share: {
                    creator_percent: 70,
                    platform_percent: 20,
                    payment_processor_percent: 10,
                  },
                  moderation: {
                    automated_scans: [
                      {
                        id: "malware",
                        label: "Malware scan",
                        status: "passed",
                        summary: "Clean.",
                      },
                    ],
                    manual_review: {
                      status: "approved",
                      reviewer: "Marketplace moderation",
                      reviewed_at: "2026-03-29T09:00:00+10:00",
                      notes: "Approved.",
                    },
                    install_allowed: true,
                  },
                  publisher_signature: {
                    algorithm: "RS256",
                    key_id: "curated-marketplace-rs256",
                    public_key: { kty: "RSA", n: "abc", e: "AQAB" },
                    value: "sig",
                  },
                  content_rating: {
                    minimum_age: 13,
                    maximum_age: null,
                    tags: ["friendly"],
                  },
                  ip_declaration: {
                    rights_confirmed: true,
                    asset_sources: ["Original asset"],
                    notes: "Rights cleared.",
                  },
                  install_supported: true,
                  core_feature: true,
                  icon_data_url: null,
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/memory/settings")) {
        const payload =
          init?.method === "PUT"
            ? {
                long_term_memory_enabled:
                  JSON.parse(String(init.body)).long_term_memory_enabled ?? true,
                summary_frequency_messages:
                  JSON.parse(String(init.body)).summary_frequency_messages ?? 25,
                cloud_backup_enabled:
                  JSON.parse(String(init.body)).cloud_backup_enabled ?? false,
                storage_mode: "local-only",
              }
            : {
                long_term_memory_enabled: true,
                summary_frequency_messages: 25,
                cloud_backup_enabled: false,
                storage_mode: "local-only",
              };

        return Promise.resolve(
          new Response(JSON.stringify(payload), { status: 200 }),
        );
      }

      if (url.endsWith("/api/memory/summaries")) {
        if (init?.method === "DELETE") {
          return Promise.resolve(
            new Response(JSON.stringify({ deleted: 0 }), { status: 200 }),
          );
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              summaries: [
                {
                  id: 1,
                  title: "Recent: local setup",
                  summary:
                    "The user focused on local setup. The companion responded with a calm local reply.",
                  message_count: 6,
                  created_at: "2026-03-29T00:00:00+00:00",
                  updated_at: "2026-03-29T00:00:00+00:00",
                  source: "local",
                },
              ],
              pending_message_count: 2,
            }),
            { status: 200 },
          ),
        );
      }

      if (url.match(/\/api\/memory\/summaries\/\d+$/) && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          title?: string;
          summary?: string;
        };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 1,
              title: body.title ?? "Recent: local setup",
              summary: body.summary ?? "Edited local summary.",
              message_count: 6,
              created_at: "2026-03-29T00:00:00+00:00",
              updated_at: "2026-03-29T01:00:00+00:00",
              source: "local",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.match(/\/api\/memory\/summaries\/\d+$/) && init?.method === "DELETE") {
        return Promise.resolve(
          new Response(JSON.stringify({ deleted: 1 }), { status: 200 }),
        );
      }

      if (url.endsWith("/api/chat")) {
        const body = JSON.parse(String(init?.body)) as { message: string };

        if (body.message === "hello") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                route: "companion-chat",
                user_message: "hello",
                assistant_response:
                  "I am softly getting my local thoughts in order. Give me a moment, then ask again.",
                action: {
                  type: "chat_reply",
                  provider: "ollama",
                  model: "llama3.1:8b-instruct",
                  error_code: "model_not_ready",
                  display_name: "Sunrise",
                },
                loading: true,
              }),
              { status: 200 },
            ),
          );
        }

        if (body.message === "set a 5 minute timer") {
          const timer = {
            id: nextUtilityId,
            kind: "timer",
            label: "5-minute timer",
            due_at: "2026-03-29T02:05:00+00:00",
            completed: false,
            created_at: "2026-03-29T02:00:00+00:00",
            updated_at: "2026-03-29T02:00:00+00:00",
            fired_at: null,
            dismissed: false,
          };
          nextUtilityId += 1;
          utilityState.timers.unshift(timer);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                route: "micro-utilities",
                user_message: body.message,
                assistant_response:
                  "I set a 5-minute timer. I will keep it subtle and local.",
                action: {
                  type: "created_timer",
                  utility: timer,
                },
                loading: false,
              }),
              { status: 200 },
            ),
          );
        }

        if (body.message === "save clipboard") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                route: "micro-utilities",
                user_message: body.message,
                assistant_response:
                  "I am ready to save the current clipboard text into local history.",
                action: {
                  type: "capture_clipboard",
                  utility: "clipboard",
                },
                loading: false,
              }),
              { status: 200 },
            ),
          );
        }

        if (body.message === "show my todo list") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                route: "micro-utilities",
                user_message: body.message,
                assistant_response:
                  "Here is your current to-do list:\n- [open] #1 Keep setup notes tidy",
                action: {
                  type: "listed_utilities",
                  utility: "todos",
                },
                loading: false,
              }),
              { status: 200 },
            ),
          );
        }

        if (body.message === "open Spotify") {
          if (!openAppGranted) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  ok: false,
                  route: "app-launcher",
                  user_message: body.message,
                  assistant_response:
                    "I can open Spotify once you allow app launches in Companion OS.",
                  action: {
                    type: "permission_required",
                    permission: "open_app",
                    target: "spotify",
                  },
                  loading: false,
                }),
                { status: 200 },
              ),
            );
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                route: "app-launcher",
                user_message: body.message,
                assistant_response: "I am opening Spotify for you.",
                action: {
                  type: "open_app",
                  app: "spotify",
                },
                loading: false,
              }),
              { status: 200 },
            ),
          );
        }

        return Promise.reject(new Error(`Unexpected chat message: ${body.message}`));
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

  return { fetchMock, utilityState };
}

describe("CompanionWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads persisted chat history and session state on startup", async () => {
    window.localStorage.setItem(
      "companion-os.session",
      JSON.stringify({
        messages: [
          {
            id: 99,
            sender: "companion",
            text: "Welcome back. I kept our last note here.",
          },
        ],
        companionState: "talking",
      }),
    );
    createFetchMock();

    render(<CompanionWorkspace />);

    expect(
      await screen.findByText("Welcome back. I kept our last note here."),
    ).toBeInTheDocument();
    expect(screen.getByText("talking")).toBeInTheDocument();
  });

  it("keeps the companion calm while the local model is warming up", async () => {
    createFetchMock();
    const user = userEvent.setup();

    render(<CompanionWorkspace />);

    await user.type(screen.getByLabelText(/Type a message/i), "hello");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText("talking")).toBeInTheDocument();
    }, { timeout: 2500 });
    expect(
      screen.getByText(/getting my local thoughts in order/i),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("idle")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows a companion-style startup notice when the selected model is missing", async () => {
    createFetchMock({
      modelStatus: {
        provider: "ollama",
        model: "qwen2.5-coder:7b-instruct",
        state: "missing",
        present: false,
        loaded: false,
        message:
          "I am softly missing my local model, qwen2.5-coder:7b-instruct. Open settings to choose another local model or download this one first.",
      },
    });

    render(<CompanionWorkspace />);

    expect(
      await screen.findByText(/missing my local model, qwen2.5-coder:7b-instruct/i),
    ).toBeInTheDocument();
  });

  it("updates the utility surface for timer creation and clipboard capture", async () => {
    createFetchMock();
    const clipboardReadText = vi.fn().mockResolvedValue("Copied local snippet");
    vi.spyOn(window.navigator.clipboard, "readText").mockImplementation(
      clipboardReadText,
    );
    const user = userEvent.setup();

    render(<CompanionWorkspace />);

    await user.click(screen.getByRole("button", { name: "Set 5 minute timer" }));
    expect(
      await screen.findByText("I set a 5-minute timer. I will keep it subtle and local."),
    ).toBeInTheDocument();
    expect(await screen.findByText("5-minute timer")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Save clipboard" }),
      ).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Save clipboard" }));
    await waitFor(() => {
      expect(clipboardReadText).toHaveBeenCalled();
    });
    expect(
      await screen.findByText("I saved that clipboard text into your local history."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Copied local snippet")).toBeInTheDocument();
  });

  it("lets the user complete, edit, and dismiss utility items from the desk", async () => {
    const { utilityState } = createFetchMock();
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("Keep launch notes polished");
    utilityState.alerts.push({
      id: 8,
      kind: "timer",
      label: "Tea timer",
      due_at: "2026-03-29T02:10:00+00:00",
      completed: false,
      created_at: "2026-03-29T02:05:00+00:00",
      updated_at: "2026-03-29T02:10:00+00:00",
      fired_at: "2026-03-29T02:10:00+00:00",
      dismissed: false,
    });
    utilityState.timers.push({
      id: 8,
      kind: "timer",
      label: "Tea timer",
      due_at: "2026-03-29T02:10:00+00:00",
      completed: false,
      created_at: "2026-03-29T02:05:00+00:00",
      updated_at: "2026-03-29T02:10:00+00:00",
      fired_at: "2026-03-29T02:10:00+00:00",
      dismissed: false,
    });

    render(<CompanionWorkspace />);

    expect(await screen.findByText("Keep setup notes tidy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(
      await screen.findByText('I marked "Keep setup notes tidy" as done.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      await screen.findByText('I updated that note to "Keep launch notes polished".'),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Tea timer").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      await screen.findByText("I tucked that alert away for you."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("retries permission-gated app launches through the same chat flow", async () => {
    createFetchMock();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<CompanionWorkspace />);

    await user.click(screen.getByRole("button", { name: "Open Spotify" }));

    expect(
      await screen.findByText(
        "I can open Spotify once you allow app launches in Companion OS.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("I am opening Spotify for you."),
    ).toBeInTheDocument();
  });

  it("shows settings details and supports reset actions", async () => {
    createFetchMock();
    const user = userEvent.setup();

    render(<CompanionWorkspace />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getAllByText("llama3.1:8b-instruct").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sunrise").length).toBeGreaterThan(0);
    expect(screen.getByText("OpenClaw ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset permissions" }));
    await waitFor(() => {
      expect(
        screen.getByText("App and browser permissions were reset."),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Reset chat history" }));
    expect(
      screen.getByText("Recent conversation history was cleared on this device."),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("companion-os.session")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Repair OpenClaw" }));
    await waitFor(() => {
      expect(
        screen.getByText("I refreshed OpenClaw and reconnected the local runtime."),
      ).toBeInTheDocument();
    });
  });

  it("lets the user save a different local model from settings", async () => {
    createFetchMock();
    const user = userEvent.setup();

    render(<CompanionWorkspace />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(
      screen.getByLabelText("Choose local model"),
      "mistral-small:24b-instruct",
    );
    await user.click(screen.getByRole("button", { name: "Save model" }));

    expect(
      await screen.findByText("Saved your local model choice for future chats."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/missing my local model, mistral-small:24b-instruct/i),
    ).toBeInTheDocument();
  });

  it("saves stream settings and previews a stream reaction bubble", async () => {
    createFetchMock();
    const user = userEvent.setup();

    render(<CompanionWorkspace />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByLabelText("Enable stream integration"));
    await user.click(
      screen.getByLabelText("Show a transparent overlay on top of the desktop"),
    );
    await user.click(
      screen.getByRole("button", { name: "Save stream setup" }),
    );

    expect(
      await screen.findByText("Stream settings were saved for this companion."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview subscriber" }));
    expect(
      await screen.findByText("Preview stream reaction sent to the companion."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(await screen.findByText("Ari just subscribed on Twitch.")).toBeInTheDocument();
  });
});
