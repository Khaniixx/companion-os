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
  "download",
  "install-openclaw",
  "configure-ai",
  "start-connect",
];

const DEFAULT_MODEL = "llama3.1:8b-instruct";

function getCurrentStep(
  installerStatus: InstallerStatus | null,
): InstallerStep | null {
  if (!installerStatus) {
    return null;
  }

  if (installerStatus.current_step === "complete") {
    return installerStatus.steps["start-connect"];
  }

  return installerStatus.steps[installerStatus.current_step as InstallerStepId] ?? null;
}

function getProgressLabel(status: InstallerStatus | null): string {
  const currentStep = getCurrentStep(status);

  if (!status || !currentStep) {
    return "Preparing your local OpenClaw setup";
  }

  if (status.connection.connected) {
    return "Your companion is ready";
  }

  if (currentStep.id === "download") {
    const missingCount =
      status.environment.missing_prerequisites.length +
      status.environment.missing_runtime_dependencies.length;
    return missingCount > 0 ? "Installing dependencies" : "Checking your system";
  }

  if (currentStep.id === "install-openclaw") {
    return "Installing OpenClaw";
  }

  if (currentStep.id === "configure-ai") {
    return "Choose your local AI";
  }

  return "Almost ready";
}

function summarizeStatus(status: InstallerStatus | null): string {
  const currentStep = getCurrentStep(status);

  if (!status || !currentStep) {
    return "Preparing a local-first OpenClaw setup.";
  }

  if (status.connection.connected) {
    return "OpenClaw is ready. Transitioning into the companion shell.";
  }

  if (currentStep.status === "failed") {
    return "Something interrupted setup, but your progress is saved. Retry or repair to continue.";
  }

  if (currentStep.status === "needs_action") {
    return currentStep.message;
  }

  return currentStep.message;
}

function getBadgeLabel(status: InstallerStep["status"]): string {
  if (status === "active") {
    return "in progress";
  }
  if (status === "needs_action") {
    return "needs action";
  }
  return status;
}

function getDependencyStateLabel(dependency: DependencyStatus): string {
  return dependency.installed ? "Ready" : "Needs setup";
}

function getDependencySummary(dependency: DependencyStatus): string {
  if (dependency.installed) {
    return dependency.version ?? "Installed";
  }

  if (dependency.approx_size_mb) {
    return `We need to install ${dependency.label} (approx. ${dependency.approx_size_mb} MB).`;
  }

  return `We need to install ${dependency.label}.`;
}

function getRetryLabel(stepId: InstallerStepId): string {
  if (stepId === "download") {
    return "Retry";
  }
  if (stepId === "install-openclaw") {
    return "Retry install";
  }
  if (stepId === "configure-ai") {
    return "Retry model setup";
  }
  return "Retry connection";
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
  const [isBusy, setIsBusy] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const autoAdvanceRef = useRef(false);

  const currentStep = getCurrentStep(installerStatus);

  const progressValue = useMemo(() => {
    if (!installerStatus) {
      return 0;
    }

    const completeCount = STEP_SEQUENCE.filter(
      (stepId) => installerStatus.steps[stepId].status === "complete",
    ).length;
    return Math.round((completeCount / STEP_SEQUENCE.length) * 100);
  }, [installerStatus]);

  const refreshStatus = useCallback(async (): Promise<InstallerStatus> => {
    const [nextStatus, availableModels] = await Promise.all([
      installerApi.getInstallerStatus(),
      installerApi.getModels().catch(() => [DEFAULT_MODEL]),
    ]);
    setInstallerStatus(nextStatus);
    setStatusMessage(summarizeStatus(nextStatus));
    setModels(availableModels.length ? availableModels : [DEFAULT_MODEL]);
    setSelectedModel((currentModel) => {
      const preferredModel = nextStatus.ai.model;
      if (availableModels.includes(preferredModel)) {
        return preferredModel;
      }
      if (availableModels.includes(currentModel)) {
        return currentModel;
      }
      if (availableModels.includes(DEFAULT_MODEL)) {
        return DEFAULT_MODEL;
      }
      return availableModels[0] ?? DEFAULT_MODEL;
    });
    return nextStatus;
  }, [installerApi]);

  const runStep = useCallback(
    async (stepId: InstallerStepId): Promise<InstallerStatus | null> => {
      setIsBusy(true);
      setStatusMessage("Saving your progress and continuing setup.");

      try {
        if (stepId === "download") {
          await installerApi.downloadSetup();
        } else if (stepId === "install-openclaw") {
          await installerApi.installOpenClaw();
        } else if (stepId === "configure-ai") {
          await installerApi.configureAI(selectedModel);
        } else {
          await installerApi.startAndConnect();
        }

        const nextStatus = await refreshStatus();
        if (nextStatus.connection.connected) {
          onComplete();
        }
        return nextStatus;
      } catch {
        try {
          return await refreshStatus();
        } finally {
          setStatusMessage(
            "Setup paused safely. Check the guidance below, then retry or repair.",
          );
        }
      } finally {
        setIsBusy(false);
        setIsHydrated(true);
      }
    },
    [installerApi, onComplete, refreshStatus, selectedModel],
  );

  const handleRepair = useCallback(async (): Promise<void> => {
    setIsBusy(true);
    setStatusMessage("Repairing the local setup and resuming from where you left off.");

    try {
      const result = await installerApi.repair();
      setInstallerStatus(result.status);
      setStatusMessage(result.message);
      if (result.status.connection.connected) {
        onComplete();
      }
    } catch {
      try {
        const nextStatus = await refreshStatus();
        setStatusMessage(summarizeStatus(nextStatus));
      } catch {
        setStatusMessage(
          "We could not reconnect to setup just yet. Please try Repair or Retry again in a moment.",
        );
      }
    } finally {
      setIsBusy(false);
      setIsHydrated(true);
    }
  }, [installerApi, onComplete, refreshStatus]);

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      try {
        const nextStatus = await refreshStatus();
        if (!active) {
          return;
        }

        if (nextStatus.connection.connected) {
          onComplete();
        }
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
  }, [onComplete, refreshStatus]);

  useEffect(() => {
    if (!installerStatus || !isHydrated || isBusy || autoAdvanceRef.current) {
      return;
    }

    if (installerStatus.connection.connected) {
      onComplete();
      return;
    }

    const activeStep = getCurrentStep(installerStatus);
    if (!activeStep) {
      return;
    }

    let nextStep: InstallerStepId | null = null;
    if (
      activeStep.id === "download" &&
      (activeStep.status === "pending" || activeStep.status === "active")
    ) {
      nextStep = "download";
    } else if (
      activeStep.id === "install-openclaw" &&
      (activeStep.status === "pending" || activeStep.status === "active")
    ) {
      nextStep = "install-openclaw";
    } else if (
      activeStep.id === "start-connect" &&
      (activeStep.status === "pending" || activeStep.status === "active")
    ) {
      nextStep = "start-connect";
    }

    if (!nextStep) {
      return;
    }

    autoAdvanceRef.current = true;
    void runStep(nextStep).finally(() => {
      autoAdvanceRef.current = false;
    });
  }, [installerStatus, isBusy, isHydrated, onComplete, runStep]);

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

  const dependencyChecks = installerStatus.environment.checks;
  const progressLabel = getProgressLabel(installerStatus);
  const recoveryInstructions = currentStep?.recovery_instructions ?? [];
  const canConfigureModel =
    installerStatus.openclaw.installed &&
    !installerStatus.connection.connected &&
    !isBusy;
  const primaryButtonLabel =
    installerStatus.steps["configure-ai"].status === "complete" &&
    installerStatus.steps["start-connect"].status !== "complete"
      ? "Start companion"
      : "Continue with local model";

  return (
    <main className="installer-shell">
      <section className="installer-hero">
        <div className="installer-copy">
          <span className="eyebrow">OpenClaw Setup</span>
          <h1>Bring the companion online with a local-first install.</h1>
          <p>
            Companion OS follows four clear steps: Download, Install OpenClaw,
            Configure AI, then Start & Connect. We save progress after every
            transition, so you can always resume from where you left off.
          </p>
        </div>

        <div className="installer-progress-card">
          <div className="installer-progress-card__header">
            <span>{progressLabel}</span>
            <strong>{progressValue}%</strong>
          </div>
          <div className="installer-progress-bar" aria-hidden="true">
            <span
              className="installer-progress-bar__value"
              style={{ width: `${progressValue}%` }}
            />
          </div>
          <p>{statusMessage}</p>
          {currentStep?.status === "failed" || currentStep?.status === "needs_action" ? (
            <p className="installer-error" role="status">
              We paused safely. Use the guidance below to continue.
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
                </div>
              </article>
            );
          })}
        </div>

        <aside className="installer-sidebar">
          <section className="installer-panel">
            <span className="eyebrow">Environment</span>
            <h2>Checking your system</h2>
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
                  <p>{getDependencySummary(dependency)}</p>
                </article>
              ))}
            </div>
            <p className="installer-panel__hint">
              Platform: <strong>{installerStatus.environment.platform}</strong>
            </p>
          </section>

          <section className="installer-panel">
            <span className="eyebrow">Guidance</span>
            <h2>What happens next</h2>
            <p className="installer-panel__hint">
              {currentStep?.message ?? "The installer is loading."}
            </p>
            {recoveryInstructions.length ? (
              <ol className="installer-recovery-list">
                {recoveryInstructions.map((instruction) => (
                  <li key={instruction}>{instruction}</li>
                ))}
              </ol>
            ) : (
              <p className="installer-panel__hint">
                Companion OS keeps moving automatically whenever it is safe to do so.
              </p>
            )}
            <div className="installer-panel__actions">
              {currentStep?.can_retry ? (
                <button
                  className="installer-secondary-button"
                  disabled={isBusy}
                  type="button"
                  onClick={() => {
                    void runStep(currentStep.id);
                  }}
                >
                  {getRetryLabel(currentStep.id)}
                </button>
              ) : null}
              {currentStep?.can_repair ? (
                <button
                  className="installer-secondary-button"
                  disabled={isBusy}
                  type="button"
                  onClick={() => {
                    void handleRepair();
                  }}
                >
                  Repair setup
                </button>
              ) : null}
            </div>
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
              disabled={!canConfigureModel}
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
              If you are unsure, keep the recommended model and continue.
            </p>
            <button
              className="installer-primary-button"
              disabled={!canConfigureModel}
              type="button"
              onClick={() => {
                if (
                  installerStatus.steps["configure-ai"].status === "complete" &&
                  installerStatus.steps["start-connect"].status !== "complete"
                ) {
                  void runStep("start-connect");
                  return;
                }

                void runStep("configure-ai");
              }}
            >
              {primaryButtonLabel}
            </button>
          </section>
        </aside>
      </section>
    </main>
  );
}
