export type InstallerStatus = {
  environment: {
    node_installed: boolean;
    rust_installed: boolean;
    cpp_toolchain_installed: boolean;
    missing_prerequisites: string[];
    all_ready: boolean;
  };
  openclaw: {
    installed: boolean;
    install_path: string;
  };
  ai: {
    provider: string;
    model: string;
  };
  connection: {
    connected: boolean;
  };
};

export type PreparePrerequisitesResult = {
  attempted: boolean;
  installed: string[];
  remaining: string[];
  message: string;
  environment: InstallerStatus["environment"];
};

export type InstallOpenClawResult = {
  install_path: string;
  message: string;
};

export type ConfigureAIResult = {
  provider: string;
  model: string;
  message: string;
};

export type StartConnectResult = {
  connected: boolean;
  message: string;
};

export type InstallerApi = {
  getInstallerStatus: () => Promise<InstallerStatus>;
  checkEnvironment: () => Promise<InstallerStatus["environment"]>;
  preparePrerequisites: () => Promise<PreparePrerequisitesResult>;
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
    request<InstallerStatus["environment"]>("/api/installer/environment-check", {
      method: "POST",
    }),
  preparePrerequisites: () =>
    request<PreparePrerequisitesResult>("/api/installer/prepare-prerequisites", {
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
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model }),
    }),
  startAndConnect: () =>
    request<StartConnectResult>("/api/installer/start-connect", {
      method: "POST",
    }),
};
