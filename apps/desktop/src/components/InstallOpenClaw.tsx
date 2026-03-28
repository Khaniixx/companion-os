import { useEffect, useMemo, useState } from "react";

import {
  type InstallerApi,
  installerApi as defaultInstallerApi,
  type InstallerStatus,
} from "../installerApi";

type InstallOpenClawProps = {
  installerApi?: InstallerApi;
  onComplete: () => void;
};

type StepStatus = "pending" | "active" | "complete" | "error";

type InstallerStepId =
  | "environment-check"
  | "prepare-prerequisites"
  | "install-openclaw"
  | "configure-ai"
  | "start-connect";

type InstallerStep = {
  id: InstallerStepId;
  title: string;
  description: string;
  status: StepStatus;
};

const INITIAL_STEPS: InstallerStep[] = [
  {
    id: "environment-check",
    title: "Environment Check",
    description: "Detect Node.js, Rust, and the C++ toolchain required for the desktop shell.",
    status: "pending",
  },
  {
    id: "prepare-prerequisites",
    title: "Prepare Prerequisites",
    description: "Silently install missing prerequisites where possible.",
    status: "pending",
  },
  {
    id: "install-openclaw",
    title: "Install OpenClaw",
    description: "Download and prepare the local OpenClaw runtime.",
    status: "pending",
  },
  {
    id: "configure-ai",
    title: "Configure AI",
    description: "Choose a default local, open-source model for core features.",
    status: "pending",
  },
  {
    id: "start-connect",
    title: "Start & Connect",
    description: "Bring the local runtime online and transition into the companion shell.",
    status: "pending",
  },
];

const DEFAULT_MODEL = "llama3.1:8b-instruct";

function updateStepStatus(
  steps: InstallerStep[],
  stepId: InstallerStepId,
  status: StepStatus,
): InstallerStep[] {
  return steps.map((step) =>
    step.id === stepId ? { ...step, status } : step,
  );
}

export function InstallOpenClaw({
  installerApi = defaultInstallerApi,
  onComplete,
}: InstallOpenClawProps) {
  const [steps, setSteps] = useState<InstallerStep[]>(INITIAL_STEPS);
  const [models, setModels] = useState<string[]>([DEFAULT_MODEL]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [statusMessage, setStatusMessage] = useState(
    "Preparing a local-first OpenClaw setup.",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [environmentStatus, setEnvironmentStatus] =
    useState<InstallerStatus["environment"] | null>(null);
  const [openClawPath, setOpenClawPath] = useState<string | null>(null);

  const progressValue = useMemo(() => {
    const completeCount = steps.filter((step) => step.status === "complete").length;
    return Math.round((completeCount / steps.length) * 100);
  }, [steps]);

  useEffect(() => {
    let active = true;

    async function runInstallerSequence(): Promise<void> {
      try {
        setErrorMessage(null);
        setSteps((currentSteps) =>
          updateStepStatus(currentSteps, "environment-check", "active"),
        );
        setStatusMessage("Checking the local environment.");

        const environment = await installerApi.checkEnvironment();
        if (!active) {
          return;
        }

        setEnvironmentStatus(environment);
        setSteps((currentSteps) =>
          updateStepStatus(currentSteps, "environment-check", "complete"),
        );

        setSteps((currentSteps) =>
          updateStepStatus(currentSteps, "prepare-prerequisites", "active"),
        );
        setStatusMessage("Preparing prerequisites for a silent local install.");

        await installerApi.preparePrerequisites();
        if (!active) {
          return;
        }

        setSteps((currentSteps) =>
          updateStepStatus(currentSteps, "prepare-prerequisites", "complete"),
        );

        setSteps((currentSteps) =>
          updateStepStatus(currentSteps, "install-openclaw", "active"),
        );
        setStatusMessage("Downloading and preparing OpenClaw locally.");

        const installResult = await installerApi.installOpenClaw();
        if (!active) {
          return;
        }

        const availableModels = await installerApi.getModels();
        if (!active) {
          return;
        }

        setOpenClawPath(installResult.install_path);
        setModels(availableModels.length > 0 ? availableModels : [DEFAULT_MODEL]);
        setSelectedModel(
          availableModels.includes(DEFAULT_MODEL)
            ? DEFAULT_MODEL
            : availableModels[0] ?? DEFAULT_MODEL,
        );
        setSteps((currentSteps) =>
          updateStepStatus(currentSteps, "install-openclaw", "complete"),
        );
        setSteps((currentSteps) =>
          updateStepStatus(currentSteps, "configure-ai", "active"),
        );
        setStatusMessage(
          "Choose the default local, open-source model before the companion starts.",
        );
      } catch (error) {
        if (!active) {
          return;
        }

        const detail =
          error instanceof Error ? error.message : "Unknown installer failure";
        setErrorMessage(detail);
        setStatusMessage("The installer needs attention before it can continue.");
        setSteps((currentSteps) => {
          const activeStep = currentSteps.find((step) => step.status === "active");
          if (!activeStep) {
            return currentSteps;
          }
          return updateStepStatus(currentSteps, activeStep.id, "error");
        });
      }
    }

    void runInstallerSequence();

    return () => {
      active = false;
    };
  }, [installerApi]);

  async function handleCompleteConfiguration(): Promise<void> {
    try {
      setIsConfiguring(true);
      setErrorMessage(null);
      setStatusMessage(`Configuring ${selectedModel} as the default local model.`);

      await installerApi.configureAI(selectedModel);
      setSteps((currentSteps) =>
        updateStepStatus(currentSteps, "configure-ai", "complete"),
      );
      setSteps((currentSteps) =>
        updateStepStatus(currentSteps, "start-connect", "active"),
      );

      setStatusMessage("Starting the local runtime and connecting the companion.");
      await installerApi.startAndConnect();

      setSteps((currentSteps) =>
        updateStepStatus(currentSteps, "start-connect", "complete"),
      );
      setStatusMessage("OpenClaw is ready. Transitioning into the companion shell.");
      onComplete();
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown start failure";
      setErrorMessage(detail);
      setSteps((currentSteps) =>
        updateStepStatus(currentSteps, "start-connect", "error"),
      );
      setStatusMessage("The installer could not finish Start & Connect.");
    } finally {
      setIsConfiguring(false);
    }
  }

  return (
    <main className="installer-shell">
      <section className="installer-hero">
        <div className="installer-copy">
          <span className="eyebrow">OpenClaw Setup</span>
          <h1>Bring the companion online with a local-first install.</h1>
          <p>
            This wizard follows the product flow exactly: detect the
            environment, prepare prerequisites, install OpenClaw, configure a
            local open-source model, then start and connect the persistent
            companion.
          </p>
        </div>

        <div className="installer-progress-card">
          <div className="installer-progress-card__header">
            <span>Progress</span>
            <strong>{progressValue}%</strong>
          </div>
          <div className="installer-progress-bar" aria-hidden="true">
            <span
              className="installer-progress-bar__value"
              style={{ width: `${progressValue}%` }}
            />
          </div>
          <p>{statusMessage}</p>
          {errorMessage ? (
            <p className="installer-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </section>

      <section className="installer-grid">
        <div className="installer-steps" aria-label="Installer steps">
          {steps.map((step, index) => (
            <article
              className={`installer-step installer-step--${step.status}`}
              key={step.id}
            >
              <div className="installer-step__index">{index + 1}</div>
              <div className="installer-step__body">
                <div className="installer-step__header">
                  <h2>{step.title}</h2>
                  <span className={`installer-step__badge installer-step__badge--${step.status}`}>
                    {step.status}
                  </span>
                </div>
                <p>{step.description}</p>
              </div>
            </article>
          ))}
        </div>

        <aside className="installer-sidebar">
          <section className="installer-panel">
            <span className="eyebrow">Environment</span>
            <h2>Automatic prerequisite prep</h2>
            <ul className="installer-checklist">
              <li>
                Node.js:{" "}
                <strong>
                  {environmentStatus?.node_installed ? "Ready" : "Checking"}
                </strong>
              </li>
              <li>
                Rust:{" "}
                <strong>
                  {environmentStatus?.rust_installed ? "Ready" : "Checking"}
                </strong>
              </li>
              <li>
                C++ Toolchain:{" "}
                <strong>
                  {environmentStatus?.cpp_toolchain_installed ? "Ready" : "Checking"}
                </strong>
              </li>
            </ul>
            {environmentStatus?.missing_prerequisites.length ? (
              <p className="installer-panel__hint">
                Missing items are prepared silently where the platform allows
                it.
              </p>
            ) : (
              <p className="installer-panel__hint">
                The environment is already ready for local companion work.
              </p>
            )}
          </section>

          <section className="installer-panel">
            <span className="eyebrow">Configure AI</span>
            <h2>Local model by default</h2>
            <label className="installer-label" htmlFor="default-model">
              Default model
            </label>
            <select
              className="installer-select"
              id="default-model"
              value={selectedModel}
              disabled={steps[3]?.status !== "active" || isConfiguring}
              onChange={(event) => setSelectedModel(event.target.value)}
            >
              {models.map((model) => (
                <option key={model} value={model}>
                  {model} (local, open-source)
                </option>
              ))}
            </select>
            <p className="installer-panel__hint">
              Core features stay local-first. API keys are not required for the
              default product flow.
            </p>
            {openClawPath ? (
              <p className="installer-panel__hint">
                OpenClaw path: <strong>{openClawPath}</strong>
              </p>
            ) : null}
            <button
              className="installer-primary-button"
              disabled={steps[3]?.status !== "active" || isConfiguring}
              type="button"
              onClick={() => {
                void handleCompleteConfiguration();
              }}
            >
              {isConfiguring ? "Finishing setup..." : "Use this model and continue"}
            </button>
          </section>
        </aside>
      </section>
    </main>
  );
}
