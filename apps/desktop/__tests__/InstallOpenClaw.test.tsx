import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InstallOpenClaw } from "../src/components/InstallOpenClaw";
import type {
  InstallerActionResult,
  InstallerApi,
  InstallerStatus,
  InstallerStepId,
} from "../src/installerApi";

function createStatus(overrides?: Partial<InstallerStatus>): InstallerStatus {
  return {
    current_step: "download",
    completed: false,
    environment: {
      platform: "windows",
      checks: [
        {
          id: "nodejs",
          label: "Node.js",
          category: "prerequisite",
          installed: true,
          version: "v22.0.0",
          guidance: ["We need Node.js to run the desktop shell."],
          approx_size_mb: 120,
          can_auto_install: true,
        },
        {
          id: "rust",
          label: "Rust",
          category: "prerequisite",
          installed: false,
          version: null,
          guidance: ["We need Rust to build the local desktop runtime."],
          approx_size_mb: 500,
          can_auto_install: true,
        },
        {
          id: "msvc",
          label: "Windows C++ / MSVC Toolchain",
          category: "prerequisite",
          installed: false,
          version: null,
          guidance: ["We need the Windows C++ build tools for the desktop shell."],
          approx_size_mb: 6000,
          can_auto_install: true,
        },
        {
          id: "ollama",
          label: "Ollama",
          category: "runtime",
          installed: false,
          version: null,
          guidance: ["We need Ollama so the companion can use a local open-source model."],
          approx_size_mb: 1500,
          can_auto_install: true,
        },
      ],
      node_installed: true,
      rust_installed: false,
      cpp_toolchain_installed: false,
      runtime_dependencies_ready: false,
      missing_prerequisites: ["Rust", "Windows C++ / MSVC Toolchain"],
      missing_runtime_dependencies: ["Ollama"],
      all_ready: false,
    },
    steps: {
      download: {
        id: "download",
        title: "Download",
        description:
          "Prepare the local setup package and any prerequisites needed on this device.",
        status: "pending",
        message: "Checking your system before setup begins.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
        updated_at: "2026-03-29T00:00:00+00:00",
        attempt_count: 0,
      },
      "install-openclaw": {
        id: "install-openclaw",
        title: "Install OpenClaw",
        description:
          "Prepare the local OpenClaw runtime files used by the desktop companion.",
        status: "pending",
        message: "OpenClaw will install after your system is ready.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
        updated_at: "2026-03-29T00:00:00+00:00",
        attempt_count: 0,
      },
      "configure-ai": {
        id: "configure-ai",
        title: "Configure AI",
        description: "Choose the default local, open-source model for the first run.",
        status: "pending",
        message: "The recommended local model is ready to confirm.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
        updated_at: "2026-03-29T00:00:00+00:00",
        attempt_count: 0,
      },
      "start-connect": {
        id: "start-connect",
        title: "Start & Connect",
        description:
          "Bring the local runtime online and connect the companion shell.",
        status: "pending",
        message: "Almost ready. The companion will connect after AI setup.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
        updated_at: "2026-03-29T00:00:00+00:00",
        attempt_count: 0,
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
    ...overrides,
  };
}

function createRepairResult(status: InstallerStatus): InstallerActionResult {
  const resumedStep = status.current_step as InstallerStepId;
  return {
    message: "Repair completed. Resuming setup from where you left off.",
    resumed_step: resumedStep,
    step: status.steps[resumedStep],
    status,
  };
}

function createInstallerApiMock(
  configureState?: (status: InstallerStatus) => void,
): InstallerApi {
  const status = createStatus();
  configureState?.(status);

  return {
    getInstallerStatus: vi.fn(async () => structuredClone(status)),
    checkEnvironment: vi.fn(async () => ({
      environment: structuredClone(status.environment),
      step: structuredClone(status.steps.download),
    })),
    downloadSetup: vi.fn(async () => {
      status.environment = {
        ...status.environment,
        checks: status.environment.checks.map((dependency) => ({
          ...dependency,
          installed: true,
          version: dependency.version ?? "Installed",
        })),
        rust_installed: true,
        cpp_toolchain_installed: true,
        runtime_dependencies_ready: true,
        missing_prerequisites: [],
        missing_runtime_dependencies: [],
        all_ready: true,
      };
      status.steps.download.status = "complete";
      status.steps.download.message = "Your system is ready for OpenClaw.";
      status.current_step = "install-openclaw";
      return {
        attempted: true,
        installed: ["Rust", "Windows C++ / MSVC Toolchain", "Ollama"],
        remaining: [],
        message: "Download finished.",
        environment: structuredClone(status.environment),
        step: structuredClone(status.steps.download),
      };
    }),
    preparePrerequisites: vi.fn(async () => ({
      attempted: false,
      installed: [],
      remaining: [],
      message: "Download finished.",
      environment: structuredClone(status.environment),
      step: structuredClone(status.steps.download),
    })),
    installOpenClaw: vi.fn(async () => {
      status.openclaw.installed = true;
      status.steps["install-openclaw"].status = "complete";
      status.steps["install-openclaw"].message =
        "OpenClaw is installed locally and ready for AI setup.";
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
      status.steps["configure-ai"].message = `${model} is ready as your default local model.`;
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
      status.current_step = "complete";
      return {
        connected: true,
        message: "Companion runtime is ready. Start & Connect completed.",
        step: structuredClone(status.steps["start-connect"]),
      };
    }),
    repair: vi.fn(async () => createRepairResult(structuredClone(status))),
  };
}

describe("InstallOpenClaw", () => {
  it("auto-advances through the automatic steps and exposes friendly progress copy", async () => {
    const installerApi = createInstallerApiMock();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={vi.fn()} />);

    await screen.findByRole("button", { name: "Continue with local model" });

    await waitFor(() => {
      expect(installerApi.downloadSetup).toHaveBeenCalled();
      expect(installerApi.installOpenClaw).toHaveBeenCalled();
    });

    expect(
      screen.getByRole("button", { name: "Continue with local model" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/The recommended local model is ready to confirm/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Core features stay local-first/i),
    ).toBeInTheDocument();
  });

  it("shows retry and repair actions with non-technical guidance for a failed download", async () => {
    const installerApi = createInstallerApiMock((status) => {
      status.current_step = "download";
      status.steps.download.status = "failed";
      status.steps.download.message =
        "Rust is taking longer than expected.";
      status.steps.download.error = "Rust is taking longer than expected.";
      status.steps.download.can_retry = true;
      status.steps.download.can_repair = true;
      status.steps.download.recovery_instructions = [
        "The automatic installer stopped because this step took too long. Your progress was saved.",
        "We need Rust to build the local desktop runtime.",
      ];
    });
    const user = userEvent.setup();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={vi.fn()} />);

    expect(
      await screen.findByText(/We paused safely. Use the guidance below to continue/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The automatic installer stopped because this step took too long/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Repair setup" }));
    await waitFor(() => {
      expect(installerApi.repair).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(installerApi.downloadSetup).toHaveBeenCalled();
    });
  });

  it("recovers from an interrupted install after restart", async () => {
    const repairedStatus = createStatus({
      current_step: "install-openclaw",
      steps: {
        ...createStatus().steps,
        download: {
          ...createStatus().steps.download,
          status: "complete",
          message: "Your system is ready for OpenClaw.",
        },
        "install-openclaw": {
          ...createStatus().steps["install-openclaw"],
          status: "needs_action",
          message: "Install OpenClaw was interrupted. Your progress is saved.",
          error: "Setup was interrupted before this step could finish.",
          can_retry: true,
          can_repair: true,
          recovery_instructions: [
            "The app was interrupted during Install OpenClaw. Your progress was saved.",
          ],
        },
      },
    });
    const installerApi = createInstallerApiMock((status) => {
      status.current_step = repairedStatus.current_step;
      status.steps = repairedStatus.steps;
      status.environment = {
        ...status.environment,
        checks: status.environment.checks.map((dependency) => ({
          ...dependency,
          installed: dependency.label !== "Ollama" ? true : dependency.installed,
          version: dependency.label !== "Ollama" ? "Installed" : dependency.version,
        })),
        rust_installed: true,
        cpp_toolchain_installed: true,
        missing_prerequisites: [],
      };
    });

    installerApi.repair = vi.fn(async () => {
      const nextStatus = createStatus({
        current_step: "configure-ai",
        environment: {
          ...repairedStatus.environment,
          platform: "windows",
          checks: repairedStatus.environment.checks.map((dependency) => ({
            ...dependency,
            installed: true,
            version: dependency.version ?? "Installed",
          })),
          node_installed: true,
          rust_installed: true,
          cpp_toolchain_installed: true,
          runtime_dependencies_ready: true,
          missing_prerequisites: [],
          missing_runtime_dependencies: [],
          all_ready: true,
        },
        openclaw: {
          installed: true,
          install_path: "C:/openclaw",
          manifest_path: "C:/openclaw/openclaw.json",
        },
        steps: {
          ...repairedStatus.steps,
          "install-openclaw": {
            ...repairedStatus.steps["install-openclaw"],
            status: "complete",
            message: "OpenClaw is installed locally and ready for AI setup.",
            can_retry: false,
            can_repair: false,
            recovery_instructions: [],
          },
        },
      });
      return createRepairResult(nextStatus);
    });

    const user = userEvent.setup();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={vi.fn()} />);

    expect(
      await screen.findByText(/The app was interrupted during Install OpenClaw/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Repair setup" }));

    await waitFor(() => {
      expect(installerApi.repair).toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Continue with local model" }),
      ).toBeInTheDocument();
    });
  });

  it("finishes the full first-run path and calls onComplete", async () => {
    const onComplete = vi.fn();
    const installerApi = createInstallerApiMock((status) => {
      status.current_step = "configure-ai";
      status.environment = {
        ...status.environment,
        checks: status.environment.checks.map((dependency) => ({
          ...dependency,
          installed: true,
          version: dependency.version ?? "Installed",
        })),
        rust_installed: true,
        cpp_toolchain_installed: true,
        runtime_dependencies_ready: true,
        missing_prerequisites: [],
        missing_runtime_dependencies: [],
        all_ready: true,
      };
      status.openclaw = {
        installed: true,
        install_path: "C:/openclaw",
        manifest_path: "C:/openclaw/openclaw.json",
      };
      status.steps.download = {
        ...status.steps.download,
        status: "complete",
        message: "Your system is ready for OpenClaw.",
      };
      status.steps["install-openclaw"] = {
        ...status.steps["install-openclaw"],
        status: "complete",
        message: "OpenClaw is installed locally and ready for AI setup.",
      };
    });
    const user = userEvent.setup();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={onComplete} />);

    const continueButton = await screen.findByRole("button", {
      name: "Continue with local model",
    });
    await waitFor(() => {
      expect(continueButton).toBeEnabled();
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
});
