import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanionWorkspace } from "./CompanionWorkspace";

function createInstallerStatus(overrides?: Partial<{ completed: boolean; model: string }>) {
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
      "environment-check": {
        id: "environment-check",
        title: "Environment Check",
        description: "",
        status: "complete",
        message: "",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
      "prepare-prerequisites": {
        id: "prepare-prerequisites",
        title: "Prepare Prerequisites",
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

function createFetchMock() {
  return vi
    .spyOn(window, "fetch")
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/preferences/permissions/open_app")) {
        const granted =
          init?.method === "PUT"
            ? Boolean(JSON.parse(String(init.body)).granted)
            : false;

        return Promise.resolve(
          new Response(
            JSON.stringify({ permission: "open_app", granted }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/preferences/permissions/open_url")) {
        const granted =
          init?.method === "PUT"
            ? Boolean(JSON.parse(String(init.body)).granted)
            : false;

        return Promise.resolve(
          new Response(
            JSON.stringify({ permission: "open_url", granted }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/installer/status")) {
        return Promise.resolve(
          new Response(JSON.stringify(createInstallerStatus()), { status: 200 }),
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
                message: "OpenClaw is installed locally and ready for model configuration.",
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
                message: "The companion is connected and ready in the desktop shell.",
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

      if (url.endsWith("/api/chat")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              route: "companion-chat",
              user_message: "hello",
              assistant_response:
                "I am almost ready, but my local model llama3.1:8b-instruct is not loaded yet.",
              action: {
                type: "chat_reply",
                provider: "ollama",
                model: "llama3.1:8b-instruct",
              },
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
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

  it("moves into the error state when the local model is unavailable", async () => {
    const fetchMock = createFetchMock();
    const user = userEvent.setup();

    render(<CompanionWorkspace />);

    await user.type(screen.getByLabelText(/Type a message/i), "hello");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText("error")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/I am almost ready, but my local model/i),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows settings details and supports reset actions", async () => {
    createFetchMock();
    const user = userEvent.setup();

    render(<CompanionWorkspace />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByText("llama3.1:8b-instruct")).toBeInTheDocument();
    expect(screen.getByText("OpenClaw ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset permissions" }));
    await waitFor(() => {
      expect(screen.getByText("App and browser permissions were reset.")).toBeInTheDocument();
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
});
