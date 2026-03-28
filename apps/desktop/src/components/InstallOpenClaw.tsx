import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type DependencyStatus,
  type InstallerApi,
  installerApi as defaultInstallerApi,
  type InstallerStatus,
  type InstallerStep,
  type InstallerStepId,
} from "../installerApi";

type InstallOpenClawProps = {
  installerApi?: InstallerApi;
  onComplete: () => void;
};

const STEP_SEQUENCE: InstallerStepId[] = [
  "environment-check",
  "prepare-prerequisites",
  "install-openclaw",
  "configure-ai",
  "start-connect",
];

const STEP_COPY: Record<
  InstallerStepId,
  { running: string; retry: string; button: string }
> = {
  "environment-check": {
    running: "Checking this device for local runtime requirements.",
    retry: "Run environment check again",
    button: "Check environment again",
  },
  "prepare-prerequisites": {
    running: "Preparing local prerequisites for the OpenClaw setup.",
    retry: "Retry prerequisite setup",
    button: "Retry setup",
  },
  "install-openclaw": {
    running: "Installing OpenClaw locally.",
    retry: "Retry OpenClaw installation",
    button: "Retry install",
  },
  "configure-ai": {
    running: "Saving the default local model.",
    retry: "Retry model configuration",
    button: "Use this model and continue",
  },
  "start-connect": {
    running: "Starting and connecting the companion.",
    retry: "Retry Start & Connect",
    button: "Start companion",
  },
};

const DEFAULT_MODEL = "llama3.1:8b-instruct";

function summarizeStatus(status: InstallerStatus | null): string {
  if (!status) {
    return "Preparing a local-first OpenClaw setup.";
  }

  if (status.connection.connected) {
    return "OpenClaw is ready. Transitioning into the companion shell.";
  }

  const currentStep = status.steps[status.current_step as InstallerStepId];
  if (currentStep) {
    return currentStep.message;
  }

  return "Preparing a local-first OpenClaw setup.";
}

function getBadgeLabel(status: InstallerStep["status"]): string {
  if (status === "needs_action") {
    return "needs action";
  }

  return status;
}

function getDependencyStateLabel(dependency: DependencyStatus): string {
  return dependency.installed ? "Ready" : "Needs setup";
}

export function InstallOpenClaw({
  installerApi = defaultInstallerApi,
  onComplete,
}: InstallOpenClawProps) {
  const [installerStatus, setInstallerStatus] = useState<InstallerStatus | null>(null);
  const [models, setModels] = useState<string[]>([DEFAULT_MODEL]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [statusMessage, setStatusMessage] = useState(
    "Preparing a local-first OpenClaw setup.",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const autoAdvanceRef = useRef(false);

  const progressValue = useMemo(() => {
    if (!installerStatus) {
      return 0;
    }

    const completeCount = STEP_SEQUENCE.filter(
      (stepId) => installerStatus.steps[stepId].status === "complete",
    ).length;
    return Math.round((completeCount / STEP_SEQUENCE.length) * 100);
  }, [installerStatus]);

  const currentStep = installerStatus
    ? installerStatus.steps[installerStatus.current_step as InstallerStepId] ?? null
    : null;

  const dependencyChecks = installerStatus?.environment.checks ?? [];
  const missingItems = installerStatus
    ? [
        ...installerStatus.environment.missing_prerequisites,
        ...installerStatus.environment.missing_runtime_dependencies,
      ]
    : [];
  const isReadyToStartOnly = installerStatus
    ? installerStatus.steps["configure-ai"].status === "complete" &&
      installerStatus.steps["start-connect"].status !== "complete" &&
      !installerStatus.connection.connected
    : false;

  const refreshStatus = useCallback(async (): Promise<InstallerStatus> => {
    const nextStatus = await installerApi.getInstallerStatus();
    setInstallerStatus(nextStatus);
    setStatusMessage(summarizeStatus(nextStatus));
    if (nextStatus.openclaw.installed) {
      const availableModels = await installerApi.getModels();
      setModels(availableModels.length ? availableModels : [DEFAULT_MODEL]);
      setSelectedModel(
        availableModels.includes(nextStatus.ai.model)
          ? nextStatus.ai.model
          : availableModels.includes(DEFAULT_MODEL)
            ? DEFAULT_MODEL
            : (availableModels[0] ?? DEFAULT_MODEL),
      );
    }
    return nextStatus;
  }, [installerApi]);

  const runStep = useCallback(
    async (stepId: InstallerStepId): Promise<InstallerStatus | null> => {
      setIsBusy(true);
      setErrorMessage(null);
      setStatusMessage(STEP_COPY[stepId].running);

      try {
        if (stepId === "environment-check") {
          await installerApi.checkEnvironment();
        } else if (stepId === "prepare-prerequisites") {
          await installerApi.preparePrerequisites();
        } else if (stepId === "install-openclaw") {
          await installerApi.installOpenClaw();
        } else if (stepId === "start-connect") {
          await installerApi.startAndConnect();
        }

        const nextStatus = await refreshStatus();
        if (nextStatus.connection.connected) {
          onComplete();
        }
        return nextStatus;
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Unknown installer failure";
        setErrorMessage(detail);

        try {
          return await refreshStatus();
        } catch {
          setStatusMessage("The installer needs attention before it can continue.");
          return null;
        }
      } finally {
        setIsBusy(false);
        setIsHydrated(true);
      }
    },
    [installerApi, onComplete, refreshStatus],
  );

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      try {
        const nextStatus = await installerApi.getInstallerStatus();
        if (!active) {
          return;
        }

        setInstallerStatus(nextStatus);
        setStatusMessage(summarizeStatus(nextStatus));

        if (nextStatus.openclaw.installed) {
          const availableModels = await installerApi.getModels();
          if (!active) {
            return;
          }

          setModels(availableModels.length ? availableModels : [DEFAULT_MODEL]);
          setSelectedModel(
            availableModels.includes(nextStatus.ai.model)
              ? nextStatus.ai.model
              : availableModels.includes(DEFAULT_MODEL)
                ? DEFAULT_MODEL
                : (availableModels[0] ?? DEFAULT_MODEL),
          );
        }
      } catch (error) {
        if (!active) {
          return;
        }

        const detail =
          error instanceof Error ? error.message : "Unknown installer failure";
        setErrorMessage(detail);
        setStatusMessage("The installer could not load its saved setup state.");
      } finally {
        if (active) {
          setIsBusy(false);
          setIsHydrated(true);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [installerApi]);

  useEffect(() => {
    if (!installerStatus || !isHydrated || isBusy || isConfiguring) {
      return;
    }

    if (installerStatus.connection.connected) {
      onComplete();
      return;
    }

    if (autoAdvanceRef.current) {
      return;
    }

    const envStep = installerStatus.steps["environment-check"];
    const prepareStep = installerStatus.steps["prepare-prerequisites"];
    const installStep = installerStatus.steps["install-openclaw"];
    const configureStep = installerStatus.steps["configure-ai"];
    const startStep = installerStatus.steps["start-connect"];

    let nextStep: InstallerStepId | null = null;
    if (envStep.status === "pending" || envStep.status === "active") {
      nextStep = "environment-check";
    } else if (
      envStep.status === "complete" &&
      (prepareStep.status === "pending" || prepareStep.status === "active")
    ) {
      nextStep = "prepare-prerequisites";
    } else if (
      prepareStep.status === "complete" &&
      (installStep.status === "pending" || installStep.status === "active")
    ) {
      nextStep = "install-openclaw";
    } else if (startStep.status === "active" && configureStep.status === "complete") {
      nextStep = "start-connect";
    }

    if (!nextStep) {
      return;
    }

    autoAdvanceRef.current = true;
    void runStep(nextStep).finally(() => {
      autoAdvanceRef.current = false;
    });
  }, [installerStatus, isBusy, isConfiguring, isHydrated, onComplete, runStep]);

  const handleConfigureAI = useCallback(async (): Promise<void> => {
    setIsBusy(true);
    setIsConfiguring(true);
    setErrorMessage(null);
    setStatusMessage(STEP_COPY["configure-ai"].running);

    try {
      await installerApi.configureAI(selectedModel);
      const configuredStatus = await refreshStatus();

      if (configuredStatus.steps["start-connect"].status !== "complete") {
        await runStep("start-connect");
      }
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown configuration error";
      setErrorMessage(detail);

      try {
        await refreshStatus();
      } catch {
        setStatusMessage("The installer needs attention before it can continue.");
      }
    } finally {
      setIsBusy(false);
      setIsConfiguring(false);
    }
  }, [installerApi, refreshStatus, runStep, selectedModel]);

  if (!installerStatus) {
    return (
      <main className="installer-shell installer-shell--loading">
        <section className="installer-hero">
          <div className="installer-copy">
            <span className="eyebrow">OpenClaw Setup</span>
            <h1>Loading your local setup.</h1>
            <p>Checking whether this PC already has a saved OpenClaw install.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="installer-shell">
      <section className="installer-hero">
        <div className="installer-copy">
          <span className="eyebrow">OpenClaw Setup</span>
          <h1>Bring the companion online with a local-first install.</h1>
          <p>
            Companion OS handles the first run in five clear steps: environment
            check, prerequisite prep, OpenClaw install, local AI configuration,
            then start and connect. Core features stay local-first by default.
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
          {STEP_SEQUENCE.map((stepId, index) => {
            const step = installerStatus.steps[stepId];
            return (
              <article
                className={`installer-step installer-step--${step.status}`}
                key={step.id}
              >
                <div className="installer-step__index">{index + 1}</div>
                <div className="installer-step__body">
                  <div className="installer-step__header">
                    <h2>{step.title}</h2>
                    <span
                      className={`installer-step__badge installer-step__badge--${step.status}`}
                    >
                      {getBadgeLabel(step.status)}
                    </span>
                  </div>
                  <p>{step.description}</p>
                  <p className="installer-step__message">{step.message}</p>
                  {step.error ? (
                    <p className="installer-step__error">{step.error}</p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <aside className="installer-sidebar">
          <section className="installer-panel">
            <span className="eyebrow">Environment</span>
            <h2>Local readiness</h2>
            <div className="installer-dependency-list">
              {dependencyChecks.map((dependency) => (
                <article className="installer-dependency" key={dependency.id}>
                  <div className="installer-dependency__header">
                    <strong>{dependency.label}</strong>
                    <span
                      className={`installer-dependency__badge installer-dependency__badge--${
                        dependency.installed ? "ready" : "missing"
                      }`}
                    >
                      {getDependencyStateLabel(dependency)}
                    </span>
                  </div>
                  <p>
                    {dependency.installed
                      ? dependency.version ?? "Installed"
                      : dependency.guidance[0]}
                  </p>
                </article>
              ))}
            </div>
            {missingItems.length ? (
              <p className="installer-panel__hint">
                Missing now: <strong>{missingItems.join(", ")}</strong>
              </p>
            ) : (
              <p className="installer-panel__hint">
                This PC is ready for the local OpenClaw path.
              </p>
            )}
          </section>

          <section className="installer-panel">
            <span className="eyebrow">Guidance</span>
            <h2>Next step</h2>
            <p className="installer-panel__hint">
              {currentStep?.message ?? "The installer is loading."}
            </p>
            {currentStep?.recovery_instructions.length ? (
              <ol className="installer-recovery-list">
                {currentStep.recovery_instructions.map((instruction) => (
                  <li key={instruction}>{instruction}</li>
                ))}
              </ol>
            ) : (
              <p className="installer-panel__hint">
                Silent setup continues automatically where it is safe and reliable.
              </p>
            )}
            {currentStep?.can_retry ? (
              <button
                className="installer-secondary-button"
                disabled={isBusy || isConfiguring}
                type="button"
                onClick={() => {
                  void runStep(currentStep.id);
                }}
              >
                {STEP_COPY[currentStep.id].retry}
              </button>
            ) : null}
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
              disabled={
                (installerStatus.steps["configure-ai"].status !== "pending" &&
                  installerStatus.steps["configure-ai"].status !== "active" &&
                  installerStatus.steps["configure-ai"].status !== "failed") ||
                !installerStatus.openclaw.installed ||
                isBusy
              }
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
            <p className="installer-panel__hint">
              OpenClaw path: <strong>{installerStatus.openclaw.install_path}</strong>
            </p>
            <button
              className="installer-primary-button"
              disabled={
                !installerStatus.openclaw.installed ||
                isBusy ||
                installerStatus.connection.connected
              }
              type="button"
              onClick={() => {
                if (isReadyToStartOnly) {
                  void runStep("start-connect");
                  return;
                }

                void handleConfigureAI();
              }}
            >
              {isConfiguring
                ? "Finishing setup..."
                : isReadyToStartOnly
                  ? STEP_COPY["start-connect"].button
                  : STEP_COPY["configure-ai"].button}
            </button>
          </section>
        </aside>
      </section>
    </main>
  );
}
