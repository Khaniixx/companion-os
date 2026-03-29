import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import { InstallOpenClaw } from "../components/InstallOpenClaw";
import type {
  ConfigureAIResult,
  DownloadSetupResult,
  EnvironmentCheckResult,
  InstallerActionResult,
  InstallerApi,
  InstallerStatus,
  InstallOpenClawResult,
  StartConnectResult,
} from "../installerApi";
import "../styles.css";

type PreviewScenario =
  | "preparing-local-ai"
  | "needs-help"
  | "choose-model"
  | "starting-companion";

type ScenarioDefinition = {
  title: string;
  description: string;
  status: InstallerStatus;
  mode: "hang-download" | "needs-help" | "configure-ai" | "hang-start-connect";
};

const DEFAULT_MODEL = "llama3.1:8b-instruct";
const ALTERNATE_MODEL = "mistral-small:24b-instruct";

function createBaseStatus(): InstallerStatus {
  return {
    current_step: "download",
    completed: false,
    environment: {
      platform: "windows",
      checks: [
        {
          id: "ollama",
          label: "Ollama",
          category: "runtime",
          installed: false,
          version: null,
          guidance: [
            "Companion OS can use the official Ollama Windows installer automatically.",
          ],
          approx_size_mb: 1500,
          can_auto_install: true,
        },
      ],
      node_installed: true,
      rust_installed: true,
      cpp_toolchain_installed: true,
      runtime_dependencies_ready: false,
      missing_prerequisites: [],
      missing_runtime_dependencies: ["Ollama"],
      all_ready: false,
    },
    steps: {
      download: {
        id: "download",
        title: "Download",
        description:
          "Prepare the local setup package and any runtime pieces needed on this device.",
        status: "pending",
        message: "Checking your system before setup begins.",
        error: null,
        recovery_instructions: [],
        can_retry: false,
        can_repair: false,
        updated_at: "2026-03-30T00:00:00+00:00",
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
        updated_at: "2026-03-30T00:00:00+00:00",
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
        updated_at: "2026-03-30T00:00:00+00:00",
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
        updated_at: "2026-03-30T00:00:00+00:00",
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
      model: DEFAULT_MODEL,
    },
    connection: {
      connected: false,
      message: "Setup has not completed yet.",
    },
  };
}

function createPreparingLocalAIStatus(): InstallerStatus {
  return createBaseStatus();
}

function createNeedsHelpStatus(): InstallerStatus {
  const status = createBaseStatus();
  status.steps.download = {
    ...status.steps.download,
    status: "needs_action",
    message: "Ollama is finishing setup.",
    error: "Ollama still needs to finish setting up.",
    can_retry: true,
    can_repair: true,
    recovery_instructions: [
      "Windows may open Ollama after installation so it can finish preparing the local runtime.",
      "Leave Ollama open for a moment, then choose Retry.",
    ],
  };
  return status;
}

function createConfigureAIStatus(): InstallerStatus {
  const status = createBaseStatus();
  status.current_step = "configure-ai";
  status.environment = {
    ...status.environment,
    checks: [
      {
        ...status.environment.checks[0],
        installed: true,
        version: "Ollama 0.6.0",
      },
    ],
    runtime_dependencies_ready: true,
    missing_runtime_dependencies: [],
    all_ready: true,
  };
  status.openclaw.installed = true;
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
  return status;
}

function createStartingCompanionStatus(): InstallerStatus {
  const status = createConfigureAIStatus();
  status.current_step = "start-connect";
  status.steps["configure-ai"] = {
    ...status.steps["configure-ai"],
    status: "complete",
    message: `${DEFAULT_MODEL} is ready as your default local model.`,
  };
  status.steps["start-connect"] = {
    ...status.steps["start-connect"],
    status: "pending",
    message: "Starting the local runtime and waking the companion.",
  };
  return status;
}

const SCENARIOS: Record<PreviewScenario, ScenarioDefinition> = {
  "preparing-local-ai": {
    title: "Preparing local AI",
    description: "Shows the active Ollama handoff while setup is moving automatically.",
    status: createPreparingLocalAIStatus(),
    mode: "hang-download",
  },
  "needs-help": {
    title: "Needs help",
    description: "Shows the calmer blocked state with retry and repair guidance.",
    status: createNeedsHelpStatus(),
    mode: "needs-help",
  },
  "choose-model": {
    title: "Choose model",
    description: "Shows the AI setup step once the local runtime pieces are ready.",
    status: createConfigureAIStatus(),
    mode: "configure-ai",
  },
  "starting-companion": {
    title: "Starting companion",
    description: "Shows the final handoff before the workspace appears.",
    status: createStartingCompanionStatus(),
    mode: "hang-start-connect",
  },
};

function createInstallerApi(scenario: ScenarioDefinition): InstallerApi {
  const status = structuredClone(scenario.status);

  const checkEnvironment = async (): Promise<EnvironmentCheckResult> => ({
    environment: structuredClone(status.environment),
    step: structuredClone(status.steps.download),
  });

  const preparePrerequisites = async (): Promise<DownloadSetupResult> => ({
    attempted: false,
    installed: [],
    remaining: status.environment.missing_runtime_dependencies,
    message: status.steps.download.message,
    environment: structuredClone(status.environment),
    step: structuredClone(status.steps.download),
  });

  const installOpenClaw = async (): Promise<InstallOpenClawResult> => ({
    install_path: status.openclaw.install_path,
    message: status.steps["install-openclaw"].message,
    step: structuredClone(status.steps["install-openclaw"]),
  });

  const configureAI = async (model: string): Promise<ConfigureAIResult> => {
    status.ai.model = model;
    status.steps["configure-ai"] = {
      ...status.steps["configure-ai"],
      status: "complete",
      message: `${model} is ready as your default local model.`,
      can_retry: false,
      can_repair: false,
      recovery_instructions: [],
    };
    status.current_step = "start-connect";
    return {
      provider: "local",
      model,
      message: `Configured local model ${model}.`,
      step: structuredClone(status.steps["configure-ai"]),
    };
  };

  const startAndConnect = async (): Promise<StartConnectResult> => {
    if (scenario.mode === "hang-start-connect") {
      return new Promise<StartConnectResult>(() => {});
    }

    status.steps["start-connect"] = {
      ...status.steps["start-connect"],
      status: "complete",
      message: "Companion runtime is ready.",
    };
    status.connection = {
      connected: true,
      message: "Companion OS is running on the local OpenClaw runtime.",
    };
    status.completed = true;
    status.current_step = "complete";
    return {
      connected: true,
      message: "Companion runtime is ready. Start & Connect completed.",
      step: structuredClone(status.steps["start-connect"]),
    };
  };

  return {
    getInstallerStatus: async () => structuredClone(status),
    checkEnvironment,
    downloadSetup: async () => {
      if (scenario.mode === "hang-download") {
        return new Promise<DownloadSetupResult>(() => {});
      }

      return {
        attempted: false,
        installed: [],
        remaining: status.environment.missing_runtime_dependencies,
        message: status.steps.download.message,
        environment: structuredClone(status.environment),
        step: structuredClone(status.steps.download),
      };
    },
    preparePrerequisites,
    installOpenClaw,
    getModels: async () => [DEFAULT_MODEL, ALTERNATE_MODEL],
    configureAI,
    startAndConnect,
    repair: async (): Promise<InstallerActionResult> => ({
      message: "Repair completed. Resume setup from where you left off.",
      resumed_step: status.current_step as
        | "download"
        | "install-openclaw"
        | "configure-ai"
        | "start-connect",
      step: structuredClone(
        status.steps[status.current_step as keyof typeof status.steps],
      ),
      status: structuredClone(status),
    }),
  };
}

function getInitialScenario(): PreviewScenario {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state");
  if (state && state in SCENARIOS) {
    return state as PreviewScenario;
  }
  return "preparing-local-ai";
}

export function InstallerPreviewApp() {
  const [scenarioKey, setScenarioKey] = useState<PreviewScenario>(getInitialScenario);
  const [resetCount, setResetCount] = useState(0);
  const [installerApi, setInstallerApi] = useState<InstallerApi>(() =>
    createInstallerApi(SCENARIOS[getInitialScenario()]),
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("state", scenarioKey);
    window.history.replaceState({}, "", `?${params.toString()}`);
  }, [scenarioKey]);

  const scenario = SCENARIOS[scenarioKey];

  useEffect(() => {
    setInstallerApi(createInstallerApi(SCENARIOS[scenarioKey]));
  }, [scenarioKey, resetCount]);

  return (
    <>
      <div className="installer-preview-toolbar">
        <div className="installer-preview-toolbar__copy">
          <strong>Installer preview</strong>
          <p>{scenario.description}</p>
        </div>
        <div className="installer-preview-toolbar__controls">
          <label className="installer-preview-toolbar__field">
            <span>State</span>
            <select
              value={scenarioKey}
              onChange={(event) => {
                setScenarioKey(event.target.value as PreviewScenario);
                setResetCount(0);
              }}
            >
              {Object.entries(SCENARIOS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="installer-preview-toolbar__button"
            type="button"
            onClick={() => setResetCount((count) => count + 1)}
          >
            Reset state
          </button>
        </div>
      </div>
      <InstallOpenClaw
        key={`${scenarioKey}-${resetCount}`}
        installerApi={installerApi}
        onComplete={() => undefined}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<InstallerPreviewApp />);
