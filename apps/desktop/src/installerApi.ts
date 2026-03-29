export type StepStatus =
  | "pending"
  | "active"
  | "complete"
  | "failed"
  | "needs_action";

export type InstallerStepId =
  | "download"
  | "install-openclaw"
  | "configure-ai"
  | "start-connect";

export type DependencyStatus = {
  id: string;
  label: string;
  category: "prerequisite" | "runtime" | string;
  installed: boolean;
  version: string | null;
  guidance: string[];
};

export type InstallerStep = {
  id: InstallerStepId;
  title: string;
  description: string;
  status: StepStatus;
  message: string;
  error: string | null;
  recovery_instructions: string[];
  can_retry: boolean;
  can_repair: boolean;
};

export type InstallerStatus = {
  current_step: string;
  completed: boolean;
  environment: {
    checks: DependencyStatus[];
    node_installed: boolean;
    rust_installed: boolean;
    cpp_toolchain_installed: boolean;
    runtime_dependencies_ready: boolean;
    missing_prerequisites: string[];
    missing_runtime_dependencies: string[];
    all_ready: boolean;
  };
  steps: Record<InstallerStepId, InstallerStep>;
  openclaw: {
    installed: boolean;
    install_path: string;
    manifest_path: string;
  };
  ai: {
    provider: string;
    model: string;
  };
  connection: {
    connected: boolean;
    message: string;
  };
};

export type EnvironmentCheckResult = {
  environment: InstallerStatus["environment"];
  step: InstallerStep;
};

export type DownloadSetupResult = {
  attempted: boolean;
  installed: string[];
  remaining: string[];
  message: string;
  environment: InstallerStatus["environment"];
  step: InstallerStep;
};

export type InstallOpenClawResult = {
  install_path: string;
  message: string;
  step: InstallerStep;
};

export type ConfigureAIResult = {
  provider: string;
  model: string;
  message: string;
  step: InstallerStep;
};

export type StartConnectResult = {
  connected: boolean;
  message: string;
  step: InstallerStep;
};

export type InstallerApi = {
  getInstallerStatus: () => Promise<InstallerStatus>;
  checkEnvironment: () => Promise<EnvironmentCheckResult>;
  downloadSetup: () => Promise<DownloadSetupResult>;
  preparePrerequisites: () => Promise<DownloadSetupResult>;
  installOpenClaw: () => Promise<InstallOpenClawResult>;
  getModels: () => Promise<string[]>;
  configureAI: (model: string) => Promise<ConfigureAIResult>;
  startAndConnect: () => Promise<StartConnectResult>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new Error(errorPayload?.detail ?? `Runtime returned ${response.status}`);
  }

  return (await response.json()) as T;
}

export const installerApi: InstallerApi = {
  getInstallerStatus: () => request<InstallerStatus>("/api/installer/status"),
  checkEnvironment: () =>
    request<EnvironmentCheckResult>("/api/installer/environment-check", {
      method: "POST",
    }),
  downloadSetup: () =>
    request<DownloadSetupResult>("/api/installer/download", {
      method: "POST",
    }),
  preparePrerequisites: () =>
    request<DownloadSetupResult>("/api/installer/prepare-prerequisites", {
      method: "POST",
    }),
  installOpenClaw: () =>
    request<InstallOpenClawResult>("/api/installer/install-openclaw", {
      method: "POST",
    }),
  getModels: () => request<string[]>("/api/installer/models"),
  configureAI: (model: string) =>
    request<ConfigureAIResult>("/api/installer/configure-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }),
  startAndConnect: () =>
    request<StartConnectResult>("/api/installer/start-connect", {
      method: "POST",
    }),
};
