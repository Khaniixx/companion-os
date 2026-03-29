import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InstallOpenClaw } from "./InstallOpenClaw";
import type {
  InstallerApi,
  InstallerStatus,
  InstallerStepId,
} from "../installerApi";

function createStatus(): InstallerStatus {
  return {
    current_step: "download",
    completed: false,
    environment: {
      checks: [
        {
          id: "nodejs",
          label: "Node.js",
          category: "prerequisite",
          installed: true,
          version: "v22.0.0",
          guidance: ["Node.js is required to build and run the desktop shell."],
        },
        {
          id: "rust",
          label: "Rust",
          category: "prerequisite",
          installed: false,
          version: null,
          guidance: ["Rust is required for the Tauri desktop runtime."],
        },
        {
          id: "msvc",
          label: "Windows C++ / MSVC Toolchain",
          category: "prerequisite",
          installed: true,
          version: "Build Tools detected",
          guidance: ["The Windows desktop build needs the Visual Studio C++ build tools."],
        },
        {
          id: "ollama",
          label: "Ollama",
          category: "runtime",
          installed: false,
          version: null,
          guidance: ["Ollama provides the local model runtime for the default setup path."],
        },
      ],
      node_installed: true,
      rust_installed: false,
      cpp_toolchain_installed: true,
      runtime_dependencies_ready: false,
      missing_prerequisites: ["Rust"],
      missing_runtime_dependencies: ["Ollama"],
      all_ready: false,
    },
    steps: {
      download: {
        id: "download",
        title: "Download",
        description:
          "Prepare the local setup package and required prerequisites for this PC.",
        status: "pending",
        message: "Download has not started yet.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
      "install-openclaw": {
        id: "install-openclaw",
        title: "Install OpenClaw",
        description: "Create the local OpenClaw runtime files used by the desktop shell.",
        status: "pending",
        message: "Waiting for prerequisites to be ready.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
      "configure-ai": {
        id: "configure-ai",
        title: "Configure AI",
        description: "Choose the default local, open-source model for first-run use.",
        status: "pending",
        message: "Choose a local model to continue.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
      "start-connect": {
        id: "start-connect",
        title: "Start & Connect",
        description: "Bring the local companion online and connect the desktop shell.",
        status: "pending",
        message: "OpenClaw will start after AI configuration.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
      },
    },
    openclaw: {
      installed: false,
      install_path: "C:/openclaw",
      manifest_path: "C:/openclaw/openclaw.json",
    },
    ai: {
      provider: "local",
      model: "llama3.1:8b-instruct",
    },
    connection: {
      connected: false,
      message: "Setup has not completed yet.",
    },
  };
}

function setCurrentStep(
  status: InstallerStatus,
  stepId: InstallerStepId | "complete",
): void {
  status.current_step = stepId;
}

function createInstallerApiMock(
  configureState?: (status: InstallerStatus) => void,
): InstallerApi {
  const status = createStatus();
  configureState?.(status);

  return {
    getInstallerStatus: vi.fn(async () => structuredClone(status)),
    checkEnvironment: vi.fn(async () => {
      return {
        environment: structuredClone(status.environment),
        step: structuredClone(status.steps.download),
      };
    }),
    downloadSetup: vi.fn(async () => {
      status.environment = {
        ...status.environment,
        checks: status.environment.checks.map((dependency) => ({
          ...dependency,
          installed: true,
          version: dependency.version ?? "Installed",
        })),
        rust_installed: true,
        runtime_dependencies_ready: true,
        missing_prerequisites: [],
        missing_runtime_dependencies: [],
        all_ready: true,
      };
      status.steps.download.status = "complete";
      status.steps.download.message =
        "Download finished. This PC is ready for OpenClaw.";
      status.current_step = "install-openclaw";
      return {
        attempted: true,
        installed: ["Rust", "Ollama"],
        remaining: [],
        message: "Download finished.",
        environment: structuredClone(status.environment),
        step: structuredClone(status.steps.download),
      };
    }),
    preparePrerequisites: vi.fn(async () => {
      return {
        attempted: true,
        installed: [],
        remaining: [],
        message: "Download finished.",
        environment: structuredClone(status.environment),
        step: structuredClone(status.steps.download),
      };
    }),
    installOpenClaw: vi.fn(async () => {
      status.openclaw.installed = true;
      status.steps["install-openclaw"].status = "complete";
      status.steps["install-openclaw"].message =
        "OpenClaw is installed locally and ready for model configuration.";
      status.current_step = "configure-ai";
      return {
        install_path: "C:/openclaw",
        message: "OpenClaw prepared locally at C:/openclaw.",
        step: structuredClone(status.steps["install-openclaw"]),
      };
    }),
    getModels: vi.fn(async () => [
      "llama3.1:8b-instruct",
      "mistral-small:24b-instruct",
    ]),
    configureAI: vi.fn(async (model: string) => {
      status.ai.model = model;
      status.steps["configure-ai"].status = "complete";
      status.steps["configure-ai"].message = `${model} is now the default local model.`;
      status.current_step = "start-connect";
      return {
        provider: "local",
        model,
        message: `Configured local model ${model}.`,
        step: structuredClone(status.steps["configure-ai"]),
      };
    }),
    startAndConnect: vi.fn(async () => {
      status.steps["start-connect"].status = "complete";
      status.connection.connected = true;
      status.connection.message =
        "Companion OS is running on the local OpenClaw runtime.";
      status.completed = true;
      setCurrentStep(status, "complete");
      return {
        connected: true,
        message: "Companion runtime is ready. Start & Connect completed.",
        step: structuredClone(status.steps["start-connect"]),
      };
    }),
  };
}

describe("InstallOpenClaw", () => {
  it("auto-advances through detection, setup, and install before AI configuration", async () => {
    const installerApi = createInstallerApiMock();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={vi.fn()} />);

    await screen.findByRole("button", { name: "Use this model and continue" });

    await waitFor(() => {
      expect(installerApi.downloadSetup).toHaveBeenCalled();
      expect(installerApi.installOpenClaw).toHaveBeenCalled();
    });

    expect(screen.getByText("Ollama")).toBeInTheDocument();
    expect(screen.getByLabelText("Default model")).toHaveValue(
      "llama3.1:8b-instruct",
    );
    expect(
      screen.getByText(/API keys are not required for the default product flow/i),
    ).toBeInTheDocument();
  });

  it("continues into Start & Connect after the user confirms the local model", async () => {
    const onComplete = vi.fn();
    const installerApi = createInstallerApiMock();
    const user = userEvent.setup();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={onComplete} />);

    const continueButton = await screen.findByRole("button", {
      name: "Use this model and continue",
    });
    await screen.findByRole("option", {
      name: /mistral-small:24b-instruct/i,
    });

    await user.selectOptions(
      screen.getByLabelText("Default model"),
      "mistral-small:24b-instruct",
    );
    await user.click(continueButton);

    await waitFor(() => {
      expect(installerApi.configureAI).toHaveBeenCalledWith(
        "mistral-small:24b-instruct",
      );
      expect(installerApi.startAndConnect).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("shows recovery guidance and a retry action when a step needs repair", async () => {
    const installerApi = createInstallerApiMock((status) => {
      status.steps.download.status = "needs_action";
      status.steps.download.message =
        "Download is paused until one quick manual step is finished.";
      status.steps.download.error =
        "winget is not available on this device.";
      status.steps.download.recovery_instructions = [
        "Install or enable App Installer from Microsoft, reopen Companion OS, and choose Retry.",
        "After finishing the missing items, reopen the wizard and choose Retry to continue.",
      ];
      status.steps.download.can_retry = true;
      status.steps.download.can_repair = true;
      status.current_step = "download";
    });
    const user = userEvent.setup();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={vi.fn()} />);

    expect(
      await screen.findAllByText(/Download is paused until one quick manual step/i),
    ).not.toHaveLength(0);
    expect(
      screen.getByText(/Install or enable App Installer from Microsoft/i),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Retry download" }),
    );

    await waitFor(() => {
      expect(installerApi.downloadSetup).toHaveBeenCalled();
    });
  });
});
