import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InstallOpenClaw } from "./InstallOpenClaw";
import type { InstallerApi, InstallerStatus } from "../installerApi";

function createInstallerStatus(): InstallerStatus {
  return {
    environment: {
      node_installed: true,
      rust_installed: true,
      cpp_toolchain_installed: true,
      missing_prerequisites: [],
      all_ready: true,
    },
    openclaw: {
      installed: false,
      install_path: "C:/openclaw",
    },
    ai: {
      provider: "local",
      model: "llama3.1:8b-instruct",
    },
    connection: {
      connected: false,
    },
  };
}

function createInstallerApiMock(
  overrides: Partial<InstallerApi> = {},
): InstallerApi {
  return {
    getInstallerStatus: vi.fn(async () => createInstallerStatus()),
    checkEnvironment: vi.fn(async () => createInstallerStatus().environment),
    preparePrerequisites: vi.fn(async () => ({
      attempted: true,
      installed: [],
      remaining: [],
      message: "Prerequisite preparation finished.",
      environment: createInstallerStatus().environment,
    })),
    installOpenClaw: vi.fn(async () => ({
      install_path: "C:/openclaw",
      message: "OpenClaw prepared locally at C:/openclaw.",
    })),
    getModels: vi.fn(async () => [
      "llama3.1:8b-instruct",
      "mistral-small:24b-instruct",
    ]),
    configureAI: vi.fn(async (model: string) => ({
      provider: "local",
      model,
      message: `Configured local model ${model}.`,
    })),
    startAndConnect: vi.fn(async () => ({
      connected: true,
      message: "Companion runtime is ready. Start & Connect completed.",
    })),
    ...overrides,
  };
}

describe("InstallOpenClaw", () => {
  it("renders the required installer flow and defaults to a local model", async () => {
    const installerApi = createInstallerApiMock();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={vi.fn()} />);

    expect(screen.getByText("Environment Check")).toBeInTheDocument();
    expect(screen.getByText("Prepare Prerequisites")).toBeInTheDocument();
    expect(screen.getByText("Install OpenClaw")).toBeInTheDocument();
    expect(screen.getAllByText("Configure AI")[0]).toBeInTheDocument();
    expect(screen.getByText("Start & Connect")).toBeInTheDocument();

    await screen.findByRole("button", { name: "Use this model and continue" });

    expect(screen.getByLabelText("Default model")).toHaveValue(
      "llama3.1:8b-instruct",
    );
    expect(
      screen.getByText(/API keys are not required for the default product flow/i),
    ).toBeInTheDocument();
  });

  it("advances through configure and start using the selected local model", async () => {
    const onComplete = vi.fn();
    const installerApi = createInstallerApiMock();
    const user = userEvent.setup();

    render(<InstallOpenClaw installerApi={installerApi} onComplete={onComplete} />);

    const continueButton = await screen.findByRole("button", {
      name: "Use this model and continue",
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
