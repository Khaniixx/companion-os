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

function getInFlightStepMessage(
  stepId: InstallerStepId,
  status: InstallerStatus | null,
): string {
  if (stepId === "download") {
    const missingPrerequisites = status?.environment.missing_prerequisites ?? [];
    const missingRuntimeDependencies =
      status?.environment.missing_runtime_dependencies ?? [];

    if (
      missingPrerequisites.length === 0 &&
      missingRuntimeDependencies.length === 1 &&
      missingRuntimeDependencies[0] === "Ollama"
    ) {
      return "Preparing Ollama on this PC so the companion can run locally.";
    }

    if (missingPrerequisites.length + missingRuntimeDependencies.length > 0) {
      return "Checking what this PC still needs and continuing setup.";
    }

    return "Checking your system and continuing setup.";
  }

  if (stepId === "install-openclaw") {
    return "Preparing the local OpenClaw files.";
  }

  if (stepId === "configure-ai") {
    return "Saving your default local model.";
  }

  return "Starting the local runtime and waking the companion.";
}

function getProgressLabel(
  status: InstallerStatus | null,
  activeStepId: InstallerStepId | null,
): string {
  const currentStep = activeStepId
    ? status?.steps[activeStepId] ?? null
    : getCurrentStep(status);

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
    if (
      status.environment.missing_prerequisites.length === 0 &&
      status.environment.missing_runtime_dependencies.length === 1 &&
      status.environment.missing_runtime_dependencies[0] === "Ollama"
    ) {
      return "Preparing your local AI";
    }
    return missingCount > 0 ? "Preparing this PC" : "Checking your system";
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
    return dependency.version ?? "Ready on this PC";
  }

  const sizeSummary = dependency.approx_size_mb
    ? ` Approx. ${dependency.approx_size_mb} MB.`
    : "";

  if (dependency.id === "ollama") {
    return `Needed for local, open-source chat on this PC.${sizeSummary}`;
  }

  if (dependency.approx_size_mb) {
    return `Companion OS needs ${dependency.label} to finish setup on this device.${sizeSummary}`;
  }

  return `Companion OS needs ${dependency.label} to finish setup on this device.`;
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

function getStepTimeHint(stepId: InstallerStepId): string {
  if (stepId === "download") {
    return "Varies";
  }
  if (stepId === "install-openclaw") {
    return "~30 sec";
  }
  if (stepId === "configure-ai") {
    return "~1 min";
  }
  return "~10 sec";
}

function getSetupPromise(stepId: InstallerStepId | null): string {
  if (stepId === "download") {
    return "Setting up the pieces that let your companion wake up locally.";
  }
  if (stepId === "install-openclaw") {
    return "Preparing the local runtime space your companion will live in.";
  }
  if (stepId === "configure-ai") {
    return "Choosing the local voice and brain your companion will use first.";
  }
  if (stepId === "start-connect") {
    return "Bringing everything together so the companion can appear on your desk.";
  }
  return "Preparing a calm local-first setup for your companion.";
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
  const [activeStepId, setActiveStepId] = useState<InstallerStepId | null>(null);
  const [isBusy, setIsBusy] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const autoAdvanceRef = useRef(false);

  const currentStep = getCurrentStep(installerStatus);

  const progressValue = useMemo(() => {
    if (!installerStatus) {
      return 0;
    }

    if (installerStatus.connection.connected) {
      return 100;
    }

    const completeCount = STEP_SEQUENCE.filter(
      (stepId) => installerStatus.steps[stepId].status === "complete",
    ).length;
    if (activeStepId) {
      const activeIndex = STEP_SEQUENCE.indexOf(activeStepId);
      if (activeIndex >= 0) {
        return Math.round(
          ((activeIndex + 0.5) / STEP_SEQUENCE.length) * 100,
        );
      }
    }
    return Math.round((completeCount / STEP_SEQUENCE.length) * 100);
  }, [activeStepId, installerStatus]);

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
      setActiveStepId(stepId);
      setStatusMessage(getInFlightStepMessage(stepId, installerStatus));

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
        setActiveStepId(null);
        setIsBusy(false);
        setIsHydrated(true);
      }
    },
    [installerApi, installerStatus, onComplete, refreshStatus, selectedModel],
  );

  const handleRepair = useCallback(async (): Promise<void> => {
    setIsBusy(true);
    setStatusMessage("Repairing the local setup and resuming from where you left off.");

    try {
      const result = await installerApi.repair();
      setInstallerStatus(result.status);
      setStatusMessage(result.message);
      setActiveStepId(null);
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
        <section className="installer-stage installer-stage--loading">
          <div className="installer-emblem" aria-hidden="true">
            <span className="installer-emblem__ring" />
            <span className="installer-emblem__core" />
          </div>
          <span className="eyebrow">OpenClaw Setup</span>
          <h1>Loading your local setup.</h1>
          <p>Checking whether this PC already has a saved OpenClaw install.</p>
        </section>
      </main>
    );
  }

  const dependencyChecks = installerStatus.environment.checks;
  const progressLabel = getProgressLabel(installerStatus, activeStepId);
  const recoveryInstructions = currentStep?.recovery_instructions ?? [];
  const visibleDependencyChecks = dependencyChecks.filter(
    (dependency) => !dependency.installed,
  );
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
      <section className="installer-stage">
        <div className="installer-emblem" aria-hidden="true">
          <span className="installer-emblem__ring" />
          <span className="installer-emblem__core" />
        </div>
        <span className="eyebrow">OpenClaw Setup</span>
        <h1>Bring your companion online.</h1>
        <p className="installer-copy__lead">
          {getSetupPromise(activeStepId ?? currentStep?.id ?? null)}
        </p>
        <p className="installer-stage__reassurance">
          Local-first by default, with saved progress at every step.
        </p>

        <div className="installer-progress-card installer-progress-card--stage">
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
          {(currentStep?.status === "failed" ||
            currentStep?.status === "needs_action") && (
            <p className="installer-error" role="status">
              We paused safely. Use the guidance below to continue.
            </p>
          )}
        </div>

        <ol className="installer-timeline" aria-label="Installer steps">
          {STEP_SEQUENCE.map((stepId, index) => {
            const step = installerStatus.steps[stepId];
            const renderedStatus =
              activeStepId === step.id &&
              (step.status === "pending" || step.status === "active")
                ? "active"
                : step.status;
            const renderedMessage =
              activeStepId === step.id ? statusMessage : step.message;
            return (
              <li
                className={`installer-timeline__item installer-timeline__item--${renderedStatus}`}
                key={step.id}
              >
                <span
                  className={`installer-timeline__marker installer-timeline__marker--${renderedStatus}`}
                  aria-hidden="true"
                >
                  {renderedStatus === "complete"
                    ? "✓"
                    : renderedStatus === "active"
                      ? ""
                      : index + 1}
                </span>
                <div className="installer-timeline__copy">
                  <strong>{step.title}</strong>
                  {(renderedStatus === "active" ||
                    renderedStatus === "failed" ||
                    renderedStatus === "needs_action") && (
                    <p>{renderedMessage}</p>
                  )}
                </div>
                <span
                  className={`installer-timeline__meta installer-timeline__meta--${renderedStatus}`}
                >
                  {renderedStatus === "pending"
                    ? getStepTimeHint(step.id)
                    : getBadgeLabel(renderedStatus)}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="installer-support-grid">
        <div className="installer-support-column">
          <section className="installer-panel">
            <span className="eyebrow">Environment</span>
            <h2>This PC still needs</h2>
            <div className="installer-dependency-list">
              {visibleDependencyChecks.map((dependency) => (
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
            {visibleDependencyChecks.length === 0 ? (
              <p className="installer-panel__hint">
                This PC already has everything needed for the next step.
              </p>
            ) : null}
            <p className="installer-panel__hint">
              Platform: <strong>{installerStatus.environment.platform}</strong>
            </p>
          </section>

          <section className="installer-panel">
            <span className="eyebrow">Guidance</span>
            <h2>What happens next</h2>
            <p className="installer-panel__hint">
              {activeStepId
                ? statusMessage
                : currentStep?.message ?? "The installer is loading."}
            </p>
            {recoveryInstructions.length ? (
              <ol className="installer-recovery-list">
                {recoveryInstructions.map((instruction) => (
                  <li key={instruction}>{instruction}</li>
                ))}
              </ol>
            ) : (
              <p className="installer-panel__hint">
                Leave this window open. Companion OS keeps moving automatically
                whenever it is safe to do so.
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
        </div>

        <aside className="installer-sidebar">
          <section className="installer-panel">
            <span className="eyebrow">Configure AI</span>
            <h2>Choose the first local personality core</h2>
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
              If you are unsure, keep the recommended model and continue. You can
              change it later in settings.
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
