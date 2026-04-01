import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearCompanionSession,
  loadCompanionSession,
  persistCompanionSession,
  type CompanionMessage,
} from "../companionSession";
import {
  transitionCompanionState,
  type CompanionState,
  type CompanionStateEvent,
} from "../companionStateMachine";
import { companionEventBus } from "../eventBus";
import { installerApi } from "../installerApi";
import {
  applyOverlayWindowState,
  COMPANION_PRESENCE_TARGET_EVENT,
  type CompanionPresenceTargetDetail,
} from "../overlayController";
import {
  microUtilityApi,
  type MicroUtilityState,
} from "../microUtilityApi";
import { packApi, type InstalledPack } from "../packApi";
import {
  speechInputApi,
  type SpeechInputSettings,
} from "../speechInputApi";
import {
  getSpeechInputSupport,
  startSpeechInputSession,
  type SpeechInputSession,
  type SpeechInputSessionStatus,
  type SpeechInputSupport,
} from "../speechInput";
import {
  streamApi,
  type StreamEvent,
  type StreamReactionPreferences,
  type StreamSettings,
  type StreamState,
} from "../streamApi";
import { CompanionAvatar } from "./CompanionAvatar";
import { MemoryPrivacySettings } from "./MemoryPrivacySettings";
import { MicroUtilitiesPanel } from "./MicroUtilitiesPanel";
import { PersonalityPackSettings } from "./PersonalityPackSettings";
import { StreamIntegrationSettings } from "./StreamIntegrationSettings";

type CompanionResponse = {
  ok: boolean;
  route: string;
  user_message: string;
  assistant_response: string;
  action?: Record<string, unknown> | null;
  loading: boolean;
};

type PermissionResponse = {
  permission: string;
  granted: boolean;
};

type ChatModelStatus = {
  provider: string;
  model: string;
  state: "ready" | "loading" | "missing";
  present: boolean;
  loaded: boolean;
  message: string;
};

type VoiceStatus = {
  enabled: boolean;
  available: boolean;
  state: "ready" | "muted" | "unavailable";
  provider: string;
  voice_id: string;
  locale: string | null;
  style: string | null;
  display_name: string;
  message: string;
};

type SpeechInputStatus = SpeechInputSettings;

type PresenceStatus = {
  enabled: boolean;
  click_through_enabled: boolean;
  anchor:
    | "desktop-right"
    | "desktop-left"
    | "active-window-right"
    | "active-window-left"
    | "active-window-top-right"
    | "active-window-top-left"
    | "workspace";
  state: "workspace" | "pinned" | "click-through";
  message: string;
};

const DEFAULT_COMPANION_NAME = "Aster";
const DEFAULT_STARTER_MESSAGE =
  "I'm here, awake locally, and ready to keep the desk steady with you.";
const starterMessages: CompanionMessage[] = [
  {
    id: 1,
    sender: "companion",
    text: DEFAULT_STARTER_MESSAGE,
  },
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const MIN_THINKING_DELAY_MS = 260;
const MAX_THINKING_DELAY_MS = 1200;

function getReplyThinkingDelay(message: string): number {
  return Math.min(
    MAX_THINKING_DELAY_MS,
    MIN_THINKING_DELAY_MS + Math.round(message.trim().length * 8),
  );
}

function waitForPacing(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function getActivePackFromResponse(packs: InstalledPack[]): InstalledPack | null {
  return packs.find((pack) => pack.active) ?? null;
}

function getAmbientDeskCue(state: CompanionState, companionTitle: string): string {
  if (state === "idle") {
    return `The desk is quiet. ${companionTitle} is nearby and ready when you are.`;
  }
  if (state === "listening") {
    return `${companionTitle} is leaning in and keeping the next step close.`;
  }
  if (state === "thinking") {
    return `${companionTitle} is tracing the local thread before answering.`;
  }
  if (state === "talking") {
    return `${companionTitle} is staying close while the thread is active.`;
  }
  if (state === "reaction") {
    return `${companionTitle} perked up at a small cue on the desk.`;
  }
  return `${companionTitle} needs a breath while the local thread settles.`;
}

function getSpeechInputReadinessLabel(
  speechInputStatus: SpeechInputStatus | null,
  support: SpeechInputSupport,
  browserState: SpeechInputSessionStatus,
): string {
  if (!support.microphone) {
    return "Mic unavailable";
  }
  if (browserState === "starting") {
    return "Starting mic";
  }
  if (browserState === "hearing") {
    return "Hearing you";
  }
  if (browserState === "listening") {
    return "Mic listening";
  }
  if (browserState === "error") {
    return "Mic needs attention";
  }
  return speechInputStatus?.enabled ? "Mic ready" : "Mic off";
}

function getSpeechInputSupportLabel(
  speechInputStatus: SpeechInputStatus | null,
  support: SpeechInputSupport,
): string {
  if (!support.microphone) {
    return "This desktop shell does not expose browser microphone capture here yet.";
  }
  if (!speechInputStatus?.enabled) {
    return "Turn speech input on before starting a mic check.";
  }
  if (support.transcription) {
    return "Browser speech recognition is available, so spoken words can drop into the composer.";
  }
  return "Mic capture is available, but browser speech recognition is not exposed here yet.";
}

function getAvatarReadiness(activePack: InstalledPack | null): {
  label: string;
  detail: string;
} {
  const avatarConfig = activePack?.avatar;
  const modelConfig = activePack?.model;
  const renderer = modelConfig?.renderer;

  if (renderer === "live2d") {
    return {
      label: "Live2D-ready",
      detail:
        avatarConfig?.stage_label ??
        "Pack declares a Live2D model manifest for a richer stage.",
    };
  }

  if (renderer === "vrm") {
    return {
      label: "VRM-ready",
      detail:
        avatarConfig?.stage_label ??
        "Pack declares a VRM model manifest for a richer stage.",
    };
  }

  if (avatarConfig?.presentation_mode === "model" || avatarConfig?.model_path) {
    return {
      label: "Model-ready",
      detail: avatarConfig?.stage_label ?? "Pack is ready for richer avatar rendering.",
    };
  }

  if (avatarConfig?.presentation_mode === "portrait" || activePack?.icon_data_url) {
    return {
      label: "Pack-styled",
      detail: avatarConfig?.stage_label ?? "Pack visuals are shaping this shell.",
    };
  }

  if (activePack !== null) {
    return {
      label: "Styled shell",
      detail: avatarConfig?.stage_label ?? "Pack metadata is shaping the fallback shell.",
    };
  }

  return {
    label: "Default shell",
    detail: "Aster is using the built-in fallback shell for now.",
  };
}

function getModelManifestSummary(activePack: InstalledPack | null): string {
  const modelConfig = activePack?.model;
  if (!modelConfig) {
    return "Renderer: shell / hooks: built-in";
  }

  const renderer = modelConfig.renderer ?? "shell";
  const hooks = [
    modelConfig.idle_hook,
    modelConfig.attached_hook,
    modelConfig.perched_hook,
    modelConfig.speaking_hook,
  ].filter((value): value is string => Boolean(value));

  return hooks.length > 0
    ? `Renderer: ${renderer} / hooks: ${hooks.join(", ")}`
    : `Renderer: ${renderer}`;
}

function getPresenceAttachmentLabel(
  presenceStatus: PresenceStatus | null,
  presenceTargetTitle: string | null,
): string {
  if (!presenceStatus?.enabled || presenceStatus.state === "workspace") {
    return "Resting in workspace";
  }
  if (presenceStatus?.anchor === "active-window-top-left") {
    return presenceTargetTitle ? `Perched on ${presenceTargetTitle}` : "Perched on active app";
  }
  if (presenceStatus?.anchor === "active-window-top-right") {
    return presenceTargetTitle ? `Perched on ${presenceTargetTitle}` : "Perched on active app";
  }
  if (presenceStatus?.anchor === "active-window-left") {
    return presenceTargetTitle
      ? `Following ${presenceTargetTitle}`
      : "Attached left of active app";
  }
  if (presenceStatus?.anchor === "active-window-right") {
    return presenceTargetTitle
      ? `Following ${presenceTargetTitle}`
      : "Attached right of active app";
  }
  if (presenceStatus?.anchor === "desktop-left") {
    return "Docked to desktop left";
  }
  if (presenceStatus?.anchor === "desktop-right") {
    return "Docked to desktop right";
  }
  return "Resting in workspace";
}

function getPresenceAttachmentDetail(
  presenceStatus: PresenceStatus | null,
  companionTitle: string,
  presenceTargetTitle: string | null,
): string {
  if (!presenceStatus?.enabled || presenceStatus.state === "workspace") {
    return `${companionTitle} stays in the main workspace until you pin desktop presence.`;
  }
  if (presenceStatus?.anchor === "active-window-top-left") {
    return presenceTargetTitle
      ? `${companionTitle} perches on ${presenceTargetTitle} and follows it as focus shifts.`
      : `${companionTitle} perches on the top-left edge of the active app and follows it as focus shifts.`;
  }
  if (presenceStatus?.anchor === "active-window-top-right") {
    return presenceTargetTitle
      ? `${companionTitle} perches on ${presenceTargetTitle} and follows it as focus shifts.`
      : `${companionTitle} perches on the top-right edge of the active app and follows it as focus shifts.`;
  }
  if (presenceStatus?.anchor === "active-window-left") {
    return presenceTargetTitle
      ? `${companionTitle} stays tucked beside ${presenceTargetTitle} and follows it as focus shifts.`
      : `${companionTitle} stays tucked to the left side of the active app and follows it as focus shifts.`;
  }
  if (presenceStatus?.anchor === "active-window-right") {
    return presenceTargetTitle
      ? `${companionTitle} stays tucked beside ${presenceTargetTitle} and follows it as focus shifts.`
      : `${companionTitle} stays tucked to the right side of the active app and follows it as focus shifts.`;
  }
  if (presenceStatus?.anchor === "desktop-left") {
    return `${companionTitle} keeps a steady place on the left desktop edge while pinned.`;
  }
  if (presenceStatus?.anchor === "desktop-right") {
    return `${companionTitle} keeps a steady place on the right desktop edge while pinned.`;
  }
  return `${companionTitle} stays in the main workspace until you pin desktop presence.`;
}

export function CompanionWorkspace() {
  const [initialSession] = useState(() => loadCompanionSession(starterMessages));
  const [companionState, setCompanionState] = useState<CompanionState>(
    initialSession.companionState,
  );
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<CompanionMessage[]>(
    initialSession.messages,
  );
  const [isSending, setIsSending] = useState(false);
  const [hasOpenAppPermission, setHasOpenAppPermission] = useState(false);
  const [hasOpenUrlPermission, setHasOpenUrlPermission] = useState(false);
  const [isLoadingOpenAppPermission, setIsLoadingOpenAppPermission] =
    useState(true);
  const [isLoadingOpenUrlPermission, setIsLoadingOpenUrlPermission] =
    useState(true);
  const [microUtilityState, setMicroUtilityState] =
    useState<MicroUtilityState | null>(null);
  const [isLoadingUtilities, setIsLoadingUtilities] = useState(true);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [isLoadingStreamState, setIsLoadingStreamState] = useState(true);
  const [isSavingStreamSettings, setIsSavingStreamSettings] = useState(false);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const [activeStreamEvent, setActiveStreamEvent] = useState<StreamEvent | null>(
    null,
  );
  const [selectedModel, setSelectedModel] = useState("llama3.1:8b-instruct");
  const [availableModels, setAvailableModels] = useState<string[]>([
    "llama3.1:8b-instruct",
  ]);
  const [modelStatus, setModelStatus] = useState<ChatModelStatus | null>(null);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [speechInputStatus, setSpeechInputStatus] =
    useState<SpeechInputStatus | null>(null);
  const [speechInputBrowserState, setSpeechInputBrowserState] =
    useState<SpeechInputSessionStatus>("idle");
  const [speechInputDraft, setSpeechInputDraft] = useState<string | null>(null);
  const [isSavingSpeechInput, setIsSavingSpeechInput] = useState(false);
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus | null>(null);
  const [presenceTarget, setPresenceTarget] =
    useState<CompanionPresenceTargetDetail | null>(null);
  const [isSavingPresence, setIsSavingPresence] = useState(false);
  const [installerCompleted, setInstallerCompleted] = useState(false);
  const [activePack, setActivePack] = useState<InstalledPack | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [isRepairingOpenClaw, setIsRepairingOpenClaw] = useState(false);
  const nextMessageIdRef = useRef(2);
  const draftRef = useRef("");
  const isSendingRef = useRef(false);
  const isWindowFocusedRef = useRef(document.hasFocus());
  const transientTimerRef = useRef<number | null>(null);
  const streamBubbleTimerRef = useRef<number | null>(null);
  const seenStreamEventIdsRef = useRef<Set<number>>(new Set());
  const seenUtilityAlertIdsRef = useRef<Set<number>>(new Set());
  const activePackRef = useRef<InstalledPack | null>(null);
  const speechInputSessionRef = useRef<SpeechInputSession | null>(null);
  const speechInputSupport = useMemo(() => getSpeechInputSupport(), []);
  const desktopPresencePinned =
    (presenceStatus?.enabled ?? false) && presenceStatus?.anchor !== "workspace";
  const overlayActive = Boolean(
    desktopPresencePinned ||
      (streamState?.settings.overlay_enabled ?? false),
  );
  const clickThroughActive = Boolean(
    !isSettingsOpen &&
      ((desktopPresencePinned && presenceStatus?.click_through_enabled) ||
        (streamState?.settings.overlay_enabled &&
          streamState.settings.click_through_enabled)),
  );
  const appendUniqueCompanionMessage = useCallback((text: string): void => {
    setMessages((currentMessages) => {
      if (
        currentMessages.some(
          (message) => message.sender === "companion" && message.text === text,
        )
      ) {
        return currentMessages;
      }

      return [
        ...currentMessages,
        {
          id: nextMessageId(),
          sender: "companion",
          text,
        },
      ];
    });
  }, []);

  useEffect(() => {
    activePackRef.current = activePack;
  }, [activePack]);

  useEffect(() => {
    return () => {
      speechInputSessionRef.current?.stop();
      speechInputSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    const highestId = messages.reduce(
      (currentHighestId, message) => Math.max(currentHighestId, message.id),
      0,
    );
    nextMessageIdRef.current = highestId + 1;
  }, [messages]);

  useEffect(() => {
    let active = true;

    async function loadWorkspaceState(): Promise<void> {
      try {
        const [
          openAppResponse,
          openUrlResponse,
          voiceResponse,
          speechInputResponse,
          presenceResponse,
          installerStatus,
          installerModels,
          packResponse,
          utilityState,
          currentStreamState,
          modelStatusResponse,
        ] = await Promise.all([
          fetch(`${API_BASE_URL}/api/preferences/permissions/open_app`),
          fetch(`${API_BASE_URL}/api/preferences/permissions/open_url`),
          fetch(`${API_BASE_URL}/api/preferences/voice`),
          speechInputApi.getSettings(),
          fetch(`${API_BASE_URL}/api/preferences/presence`),
          installerApi.getInstallerStatus(),
          installerApi.getModels().catch(() => []),
          packApi.listPacks(),
          microUtilityApi.getState(),
          streamApi.getState(),
          fetch(`${API_BASE_URL}/api/chat/model-status`),
        ]);

        if (
          !openAppResponse.ok ||
          !openUrlResponse.ok ||
          !voiceResponse.ok ||
          !presenceResponse.ok ||
          !modelStatusResponse.ok
        ) {
          throw new Error("Runtime returned an unexpected permissions response");
        }

        const [
          openAppData,
          openUrlData,
          nextVoiceStatus,
          nextSpeechInputStatus,
          nextPresenceStatus,
          nextModelStatus,
        ] = (await Promise.all([
          openAppResponse.json(),
          openUrlResponse.json(),
          voiceResponse.json(),
          Promise.resolve(speechInputResponse),
          presenceResponse.json(),
          modelStatusResponse.json(),
        ])) as [
          PermissionResponse,
          PermissionResponse,
          VoiceStatus,
          SpeechInputStatus,
          PresenceStatus,
          ChatModelStatus,
        ];

        if (!active) {
          return;
        }

        setHasOpenAppPermission(openAppData.granted);
        setHasOpenUrlPermission(openUrlData.granted);
        setVoiceStatus(nextVoiceStatus);
        setSpeechInputStatus(nextSpeechInputStatus);
        setPresenceStatus(nextPresenceStatus);
        setSelectedModel(installerStatus.ai.model);
        setAvailableModels(
          installerModels.length > 0 ? installerModels : [installerStatus.ai.model],
        );
        setModelStatus(nextModelStatus);
        setInstallerCompleted(installerStatus.completed);
        setActivePack(getActivePackFromResponse(packResponse.packs));
        setMicroUtilityState(utilityState);
        seenUtilityAlertIdsRef.current = new Set(
          utilityState.alerts.map((item) => item.id),
        );
        setStreamState(currentStreamState);
        seenStreamEventIdsRef.current = new Set(
          currentStreamState.recent_events.map((event) => event.id),
        );
        if (nextModelStatus.state !== "ready") {
          appendUniqueCompanionMessage(nextModelStatus.message);
        }
      } catch {
        if (!active) {
          return;
        }

        setHasOpenAppPermission(false);
        setHasOpenUrlPermission(false);
        setInstallerCompleted(false);
        setMicroUtilityState(null);
        setStreamState(null);
        setModelStatus(null);
        setVoiceStatus(null);
        setSpeechInputStatus(null);
        setPresenceStatus(null);
        setActivePack(null);
      } finally {
        if (active) {
          setIsLoadingOpenAppPermission(false);
          setIsLoadingOpenUrlPermission(false);
          setIsLoadingUtilities(false);
          setIsLoadingStreamState(false);
        }
      }
    }

    void loadWorkspaceState();

    return () => {
      active = false;
    };
  }, [appendUniqueCompanionMessage]);

  useEffect(() => {
    if (isLoadingUtilities) {
      return;
    }

    let active = true;
    const intervalId = window.setInterval(() => {
      void pollUtilityState();
    }, 5000);

    async function pollUtilityState(): Promise<void> {
      try {
        const nextState = await microUtilityApi.getState();
        if (!active) {
          return;
        }

        setMicroUtilityState(nextState);
        for (const alert of nextState.alerts) {
          if (seenUtilityAlertIdsRef.current.has(alert.id)) {
            continue;
          }

          seenUtilityAlertIdsRef.current.add(alert.id);
          appendUniqueCompanionMessage(
            alert.kind === "alarm"
              ? `${alert.label} is ready now.`
              : `${alert.label} just finished.`,
          );
          companionEventBus.emit("utilityActionCompleted", {
            action: alert.kind === "alarm" ? "created_alarm" : "created_timer",
          });
        }
      } catch {
        if (!active) {
          return;
        }
      }
    }

    void pollUtilityState();

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [appendUniqueCompanionMessage, isLoadingUtilities]);

  useEffect(() => {
    void applyOverlayWindowState({
      enabled: overlayActive,
      clickThroughEnabled: clickThroughActive,
      anchor: presenceStatus?.enabled ? presenceStatus.anchor : undefined,
    });
  }, [clickThroughActive, overlayActive, presenceStatus?.anchor, presenceStatus?.enabled]);

  useEffect(() => {
    const handlePresenceTarget = (event: Event) => {
      const customEvent = event as CustomEvent<CompanionPresenceTargetDetail>;
      setPresenceTarget(customEvent.detail);
    };

    window.addEventListener(
      COMPANION_PRESENCE_TARGET_EVENT,
      handlePresenceTarget as EventListener,
    );

    return () => {
      window.removeEventListener(
        COMPANION_PRESENCE_TARGET_EVENT,
        handlePresenceTarget as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!clickThroughActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setSettingsNotice("Desktop click-through was turned off.");
      void (async () => {
        try {
          if (desktopPresencePinned && presenceStatus?.click_through_enabled) {
            const response = await fetch(`${API_BASE_URL}/api/preferences/presence`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ click_through_enabled: false }),
            });
            if (!response.ok) {
              throw new Error("Presence update failed");
            }
            setPresenceStatus((await response.json()) as PresenceStatus);
          }

          if (
            streamState?.settings.overlay_enabled &&
            streamState.settings.click_through_enabled
          ) {
            const settings = await streamApi.updateSettings({
              click_through_enabled: false,
            });
            setStreamState((currentState) =>
              currentState === null
                ? {
                    settings,
                    recent_events: [],
                  }
                : {
                    ...currentState,
                    settings,
                  },
            );
          }
        } catch {
          setSettingsNotice("I could not turn desktop click-through off yet.");
        }
      })();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    clickThroughActive,
    desktopPresencePinned,
    presenceStatus?.click_through_enabled,
    streamState,
  ]);

  useEffect(() => {
    if (isLoadingStreamState) {
      return;
    }

    let active = true;
    const intervalId = window.setInterval(() => {
      void pollStreamEvents();
    }, 5000);

    async function warmPoll(): Promise<void> {
      await pollStreamEvents();
    }

    async function pollStreamEvents(): Promise<void> {
      try {
        const events = await streamApi.getEvents();
        if (!active) {
          return;
        }

        setStreamState((currentState) =>
          currentState === null
            ? null
            : {
                ...currentState,
                recent_events: events,
              },
        );

        for (const event of events) {
          if (seenStreamEventIdsRef.current.has(event.id)) {
            continue;
          }

          seenStreamEventIdsRef.current.add(event.id);
          if (!event.should_react) {
            continue;
          }

          if (streamBubbleTimerRef.current !== null) {
            window.clearTimeout(streamBubbleTimerRef.current);
          }
          setActiveStreamEvent(event);
          streamBubbleTimerRef.current = window.setTimeout(() => {
            streamBubbleTimerRef.current = null;
            setActiveStreamEvent(null);
          }, 7000);
          companionEventBus.emit("utilityActionCompleted", {
            action: "stream_event",
          });
          break;
        }
      } catch {
        if (!active) {
          return;
        }
      }
    }

    void warmPoll();

    return () => {
      active = false;
      window.clearInterval(intervalId);
      if (streamBubbleTimerRef.current !== null) {
        window.clearTimeout(streamBubbleTimerRef.current);
        streamBubbleTimerRef.current = null;
      }
    };
  }, [isLoadingStreamState]);

  useEffect(() => {
    function clearTransientTimer(): void {
      if (transientTimerRef.current !== null) {
        window.clearTimeout(transientTimerRef.current);
        transientTimerRef.current = null;
      }
    }

    function applyTransition(event: CompanionStateEvent): void {
      const transition = transitionCompanionState(event, {
        draft: draftRef.current,
        focused: isWindowFocusedRef.current,
        isSending: isSendingRef.current,
      });

      clearTransientTimer();
      setCompanionState(transition.state);

      if (transition.durationMs !== null) {
        transientTimerRef.current = window.setTimeout(() => {
          transientTimerRef.current = null;
          const settledTransition = transitionCompanionState(
            { type: "settle" },
            {
              draft: draftRef.current,
              focused: isWindowFocusedRef.current,
              isSending: isSendingRef.current,
            },
          );
          setCompanionState(settledTransition.state);
        }, transition.durationMs);
      }
    }

    const unsubscribeDraftChanged = companionEventBus.subscribe(
      "draftChanged",
      ({ payload }) => {
        draftRef.current = payload.draft;

        if (isSendingRef.current) {
          return;
        }

        applyTransition({
          type: "draftChanged",
          draft: payload.draft,
        });
      },
    );

    const unsubscribeUserMessageSent = companionEventBus.subscribe(
      "userMessageSent",
      () => {
        applyTransition({ type: "userMessageSent" });
      },
    );

    const unsubscribeResponseReceived = companionEventBus.subscribe(
      "responseReceived",
      ({ payload }) => {
        applyTransition({
          type: "responseReceived",
          ok: payload.ok,
          messageLength: payload.messageLength,
        });
      },
    );

    const unsubscribeUtilityActionCompleted = companionEventBus.subscribe(
      "utilityActionCompleted",
      ({ payload }) => {
        applyTransition({
          type: "utilityActionCompleted",
          action: payload.action,
        });
      },
    );

    const unsubscribeWindowFocusChanged = companionEventBus.subscribe(
      "windowFocusChanged",
      ({ payload }) => {
        isWindowFocusedRef.current = payload.focused;

        if (isSendingRef.current || transientTimerRef.current !== null) {
          return;
        }

        applyTransition({
          type: "windowFocusChanged",
          focused: payload.focused,
        });
      },
    );

    const handleWindowFocus = () => {
      companionEventBus.emit("windowFocusChanged", { focused: true });
    };

    const handleWindowBlur = () => {
      companionEventBus.emit("windowFocusChanged", { focused: false });
    };

    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      clearTransientTimer();
      unsubscribeDraftChanged();
      unsubscribeUserMessageSent();
      unsubscribeResponseReceived();
      unsubscribeUtilityActionCompleted();
      unsubscribeWindowFocusChanged();
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    persistCompanionSession(messages, companionState);
  }, [messages, companionState]);

  function nextMessageId(): number {
    const currentId = nextMessageIdRef.current;
    nextMessageIdRef.current += 1;
    return currentId;
  }

  function appendMessage(sender: "companion" | "user", text: string): void {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: nextMessageId(),
        sender,
        text,
      },
    ]);
  }

  function appendCompanionMessage(text: string, ok: boolean): void {
    appendMessage("companion", text);
    companionEventBus.emit("responseReceived", {
      message: text,
      ok,
      messageLength: text.trim().length,
    });
  }

  async function persistPermission(
    permission: "open_app" | "open_url",
    granted: boolean,
  ): Promise<boolean> {
    const response = await fetch(
      `${API_BASE_URL}/api/preferences/permissions/${permission}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ granted }),
      },
    );

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as
        | { detail?: string }
        | null;
      throw new Error(
        errorPayload?.detail ?? `Runtime returned ${response.status}`,
      );
    }

    const data: PermissionResponse = (await response.json()) as PermissionResponse;
    if (permission === "open_app") {
      setHasOpenAppPermission(data.granted);
    } else {
      setHasOpenUrlPermission(data.granted);
    }
    return data.granted;
  }

  async function persistVoiceEnabled(enabled: boolean): Promise<VoiceStatus> {
    const response = await fetch(`${API_BASE_URL}/api/preferences/voice`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled }),
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as
        | { detail?: string }
        | null;
      throw new Error(
        errorPayload?.detail ?? `Runtime returned ${response.status}`,
      );
    }

    const data = (await response.json()) as VoiceStatus;
    setVoiceStatus(data);
    return data;
  }

  async function persistSpeechInputSettings(
    payload: Partial<{
      enabled: boolean;
      transcription_enabled: boolean;
    }>,
  ): Promise<SpeechInputStatus> {
    const data = await speechInputApi.updateSettings(payload);
    setSpeechInputStatus(data);
    return data;
  }

  const refreshVoiceStatus = useCallback(async (): Promise<VoiceStatus> => {
    const response = await fetch(`${API_BASE_URL}/api/preferences/voice`);
    if (!response.ok) {
      throw new Error(`Runtime returned ${response.status}`);
    }

    const data = (await response.json()) as VoiceStatus;
    setVoiceStatus(data);
    return data;
  }, []);

  const refreshSpeechInputStatus = useCallback(
    async (): Promise<SpeechInputStatus> => {
      const data = await speechInputApi.getSettings();
      setSpeechInputStatus(data);
      return data;
    },
    [],
  );

  async function persistPresenceSettings(
    payload: Partial<{
      enabled: boolean;
      click_through_enabled: boolean;
      anchor: PresenceStatus["anchor"];
    }>,
  ): Promise<PresenceStatus> {
    const response = await fetch(`${API_BASE_URL}/api/preferences/presence`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as
        | { detail?: string }
        | null;
      throw new Error(
        errorPayload?.detail ?? `Runtime returned ${response.status}`,
      );
    }

    const data = (await response.json()) as PresenceStatus;
    setPresenceStatus(data);
    return data;
  }

  async function refreshMicroUtilitiesState(): Promise<MicroUtilityState> {
    const state = await microUtilityApi.getState();
    setMicroUtilityState(state);
    seenUtilityAlertIdsRef.current = new Set(state.alerts.map((item) => item.id));
    return state;
  }

  async function refreshWorkspaceSettings(): Promise<void> {
    const [
      openAppResponse,
      openUrlResponse,
      voiceResponse,
      speechInputResponse,
      presenceResponse,
      installerStatus,
      installerModels,
      packResponse,
      utilityState,
      nextStreamState,
      modelStatusResponse,
    ] = await Promise.all([
      fetch(`${API_BASE_URL}/api/preferences/permissions/open_app`),
      fetch(`${API_BASE_URL}/api/preferences/permissions/open_url`),
      fetch(`${API_BASE_URL}/api/preferences/voice`),
      speechInputApi.getSettings(),
      fetch(`${API_BASE_URL}/api/preferences/presence`),
      installerApi.getInstallerStatus(),
      installerApi.getModels().catch(() => []),
      packApi.listPacks(),
      microUtilityApi.getState(),
      streamApi.getState(),
      fetch(`${API_BASE_URL}/api/chat/model-status`),
    ]);

    if (
      !openAppResponse.ok ||
      !openUrlResponse.ok ||
      !voiceResponse.ok ||
      !presenceResponse.ok ||
      !modelStatusResponse.ok
    ) {
      throw new Error("Runtime returned an unexpected settings response");
    }

    const [
      openAppData,
      openUrlData,
      nextVoiceStatus,
      nextSpeechInputStatus,
      nextPresenceStatus,
      nextModelStatus,
    ] = (await Promise.all([
      openAppResponse.json(),
      openUrlResponse.json(),
      voiceResponse.json(),
      Promise.resolve(speechInputResponse),
      presenceResponse.json(),
      modelStatusResponse.json(),
    ])) as [
      PermissionResponse,
      PermissionResponse,
      VoiceStatus,
      SpeechInputStatus,
      PresenceStatus,
      ChatModelStatus,
    ];

    setHasOpenAppPermission(openAppData.granted);
    setHasOpenUrlPermission(openUrlData.granted);
    setVoiceStatus(nextVoiceStatus);
    setSpeechInputStatus(nextSpeechInputStatus);
    setPresenceStatus(nextPresenceStatus);
    setSelectedModel(installerStatus.ai.model);
    setAvailableModels(
      installerModels.length > 0 ? installerModels : [installerStatus.ai.model],
    );
    setModelStatus(nextModelStatus);
    setInstallerCompleted(installerStatus.completed);
    setActivePack(getActivePackFromResponse(packResponse.packs));
    setMicroUtilityState(utilityState);
    setStreamState(nextStreamState);
    seenStreamEventIdsRef.current = new Set(
      nextStreamState.recent_events.map((event) => event.id),
    );
  }

  async function handleResetChatHistory(): Promise<void> {
    clearCompanionSession();
    setMessages(starterMessages);
    setCompanionState("idle");
    draftRef.current = "";
    setDraft("");
    setSettingsNotice("Recent conversation history was cleared on this device.");
  }

  async function handleResetPermissions(): Promise<void> {
    try {
      await Promise.all([
        persistPermission("open_app", false),
        persistPermission("open_url", false),
      ]);
      setSettingsNotice("App and browser permissions were reset.");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown permission reset error";
      setSettingsNotice(`I could not reset permissions: ${detail}`);
    }
  }

  async function handleRepairOpenClaw(): Promise<void> {
    try {
      setIsRepairingOpenClaw(true);
      setSettingsNotice("Refreshing the local OpenClaw installation.");
      await installerApi.installOpenClaw();
      await installerApi.startAndConnect();
      await refreshWorkspaceSettings();
      appendCompanionMessage(
        "I refreshed OpenClaw and reconnected the local runtime.",
        true,
      );
      companionEventBus.emit("utilityActionCompleted", {
        action: "runtime_repaired",
      });
      setSettingsNotice("OpenClaw was refreshed and reconnected.");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown repair error";
      appendCompanionMessage(
        "I tried to repair OpenClaw, but I still need a moment before I can reconnect.",
        false,
      );
      setSettingsNotice(`OpenClaw still needs attention: ${detail}`);
    } finally {
      setIsRepairingOpenClaw(false);
    }
  }

  async function handleSaveModelSelection(): Promise<void> {
    try {
      setIsSavingModel(true);
      await installerApi.configureAI(selectedModel);

      const response = await fetch(`${API_BASE_URL}/api/chat/model-status`);
      if (!response.ok) {
        throw new Error(`Runtime returned ${response.status}`);
      }

      const nextModelStatus = (await response.json()) as ChatModelStatus;
      setModelStatus(nextModelStatus);
      setSettingsNotice("Saved your local model choice for future chats.");
      appendCompanionMessage(
        nextModelStatus.state === "ready"
          ? "I saved that local model and I am ready to use it."
          : nextModelStatus.message,
        true,
      );
      companionEventBus.emit("utilityActionCompleted", {
        action: "model_saved",
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown model save error";
      setSettingsNotice(`I could not save that model yet: ${detail}`);
    } finally {
      setIsSavingModel(false);
    }
  }

  async function handleToggleVoiceEnabled(enabled: boolean): Promise<void> {
    try {
      setIsSavingVoice(true);
      const nextVoiceStatus = await persistVoiceEnabled(enabled);
      setSettingsNotice(
        enabled
          ? "Voice is ready again for this companion."
          : "Voice is resting for now.",
      );
      appendCompanionMessage(nextVoiceStatus.message, true);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown voice settings error";
      setSettingsNotice(`I could not save voice settings yet: ${detail}`);
    } finally {
      setIsSavingVoice(false);
    }
  }

  async function handleToggleSpeechInputEnabled(enabled: boolean): Promise<void> {
    try {
      setIsSavingSpeechInput(true);
      const nextSpeechInputStatus = await persistSpeechInputSettings({ enabled });
      if (!enabled) {
        speechInputSessionRef.current?.stop();
        speechInputSessionRef.current = null;
        setSpeechInputBrowserState("idle");
        setSpeechInputDraft(null);
      }
      setSettingsNotice(
        enabled
          ? "Speech input is ready when you want to talk."
          : "Speech input is resting for now.",
      );
      appendCompanionMessage(nextSpeechInputStatus.message, true);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown speech input settings error";
      setSettingsNotice(`I could not save speech input settings yet: ${detail}`);
    } finally {
      setIsSavingSpeechInput(false);
    }
  }

  async function handleToggleSpeechTranscription(
    transcriptionEnabled: boolean,
  ): Promise<void> {
    try {
      setIsSavingSpeechInput(true);
      await persistSpeechInputSettings({
        transcription_enabled: transcriptionEnabled,
      });
      setSettingsNotice(
        transcriptionEnabled
          ? "Browser transcription is on for speech input."
          : "Speech input will stay mic-only until you turn transcription back on.",
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown transcription settings error";
      setSettingsNotice(`I could not save speech input settings yet: ${detail}`);
    } finally {
      setIsSavingSpeechInput(false);
    }
  }

  async function handleSpeechInputSessionToggle(): Promise<void> {
    if (speechInputSessionRef.current !== null) {
      speechInputSessionRef.current.stop();
      speechInputSessionRef.current = null;
      setSpeechInputBrowserState("idle");
      setSettingsNotice("Speech input stopped listening.");
      return;
    }

    if (!(speechInputStatus?.enabled ?? false)) {
      setSettingsNotice("Turn speech input on before starting a mic check.");
      return;
    }

    try {
      setSpeechInputDraft(null);
      speechInputSessionRef.current = await startSpeechInputSession({
        locale: speechInputStatus?.locale,
        transcriptionEnabled: speechInputStatus?.transcription_enabled,
        onStatusChange: (status) => {
          setSpeechInputBrowserState(status);
        },
        onTranscript: (transcript) => {
          setSpeechInputDraft(transcript);
          handleDraftChange(transcript);
          setSettingsNotice(`Heard: "${transcript}"`);
        },
        onError: (message) => {
          setSettingsNotice(message);
        },
      });
    } catch (error) {
      setSpeechInputBrowserState("error");
      const detail =
        error instanceof Error ? error.message : "Unknown speech input start error";
      setSettingsNotice(detail);
    }
  }

  async function handleSavePresenceSettings(
    payload: Partial<{
      enabled: boolean;
      click_through_enabled: boolean;
      anchor: PresenceStatus["anchor"];
    }>,
  ): Promise<void> {
    try {
      setIsSavingPresence(true);
      const nextPresenceStatus = await persistPresenceSettings(payload);
      setSettingsNotice(nextPresenceStatus.message);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown presence settings error";
      setSettingsNotice(`I could not save desktop presence yet: ${detail}`);
    } finally {
      setIsSavingPresence(false);
    }
  }

  async function handleSaveStreamSettings(
    payload: Partial<StreamSettings>,
  ): Promise<void> {
    try {
      setIsSavingStreamSettings(true);
      const settings = await streamApi.updateSettings(payload);
      setStreamState((currentState) =>
        currentState === null
          ? {
              settings,
              recent_events: [],
            }
          : {
              ...currentState,
              settings,
            },
      );
      setStreamNotice("Stream settings were saved for this companion.");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown stream settings error";
      setStreamNotice(`I could not save stream settings yet: ${detail}`);
    } finally {
      setIsSavingStreamSettings(false);
    }
  }

  async function handlePreviewStreamEvent(
    type: keyof StreamReactionPreferences,
  ): Promise<void> {
    try {
      const event = await streamApi.previewEvent(type);
      setStreamState((currentState) =>
        currentState === null
          ? null
          : {
              ...currentState,
              recent_events: [event, ...currentState.recent_events].slice(0, 20),
            },
      );
      seenStreamEventIdsRef.current.add(event.id);
      setActiveStreamEvent(event);
      if (streamBubbleTimerRef.current !== null) {
        window.clearTimeout(streamBubbleTimerRef.current);
      }
      streamBubbleTimerRef.current = window.setTimeout(() => {
        streamBubbleTimerRef.current = null;
        setActiveStreamEvent(null);
      }, 7000);
      companionEventBus.emit("utilityActionCompleted", {
        action: "stream_event",
      });
      setStreamNotice("Preview stream reaction sent to the companion.");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown preview error";
      setStreamNotice(`I could not preview a stream event yet: ${detail}`);
    }
  }

  async function handleClearStreamEvents(): Promise<void> {
    try {
      await streamApi.clearEvents();
      setStreamState((currentState) =>
        currentState === null
          ? null
          : {
              ...currentState,
              recent_events: [],
            },
      );
      seenStreamEventIdsRef.current = new Set();
      setActiveStreamEvent(null);
      setStreamNotice("Recent stream events were cleared.");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown stream clear error";
      setStreamNotice(`I could not clear stream events yet: ${detail}`);
    }
  }

  function requestPermissionConfirmation(
    permission: "open_app" | "open_url",
    target: string | null,
  ): boolean {
    if (permission === "open_app") {
      const formattedTarget = target ? target.replace(/[-_]/g, " ") : "that app";
      const readableTarget =
        formattedTarget.charAt(0).toUpperCase() + formattedTarget.slice(1);
      return window.confirm(
        `Allow Companion OS to launch ${readableTarget}?`,
      );
    }

    return window.confirm(
      "Allow Companion OS to open links and searches in your default browser?",
    );
  }

  async function captureClipboardIntoHistory(): Promise<void> {
    let clipboardText = "";

    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      appendCompanionMessage(
        "I could not reach the clipboard yet. Try the save action again after allowing clipboard access for this window.",
        false,
      );
      return;
    }

    if (!clipboardText.trim()) {
      appendCompanionMessage(
        "Your clipboard is empty right now, so there was nothing to save.",
        false,
      );
      return;
    }

    try {
      const result = await microUtilityApi.captureClipboard(clipboardText);
      await refreshMicroUtilitiesState();
      appendCompanionMessage(result.message, true);
      companionEventBus.emit("utilityActionCompleted", {
        action: "capture_clipboard",
      });
    } catch {
      appendCompanionMessage(
        "I could not tuck that clipboard note away just yet. Please try once more.",
        false,
      );
    }
  }

  async function handleResponseAction(
    action: Record<string, unknown> | null | undefined,
    userText: string,
  ): Promise<void> {
    if (!action || typeof action.type !== "string") {
      return;
    }

    if (action.type === "capture_clipboard") {
      await captureClipboardIntoHistory();
      return;
    }

    if (action.type === "permission_required") {
      const permission =
        action.permission === "open_app" || action.permission === "open_url"
          ? action.permission
          : null;

      if (permission === null) {
        return;
      }

      const target =
        typeof action.target === "string" ? action.target : null;
      const confirmed = requestPermissionConfirmation(permission, target);
      if (!confirmed) {
        return;
      }

      try {
        await persistPermission(permission, true);
      } catch {
        appendCompanionMessage(
          "I could not hold onto that permission just yet. Please try again in a moment.",
          false,
        );
        return;
      }

      await submitMessage(userText, {
        appendUserMessage: false,
        force: true,
      });
      return;
    }

    if (
      action.type === "created_timer" ||
      action.type === "created_alarm" ||
      action.type === "created_reminder" ||
      action.type === "created_todo" ||
      action.type === "shortcut_executed" ||
      action.type === "open_app" ||
      action.type === "open_url" ||
      action.type === "search_query"
    ) {
      await refreshMicroUtilitiesState();
      companionEventBus.emit("utilityActionCompleted", {
        action: action.type,
      });
      return;
    }

    if (action.type === "listed_utilities") {
      await refreshMicroUtilitiesState();
    }
  }

  async function sendMessageToRuntime(userText: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: userText }),
      });

      if (!response.ok) {
        throw new Error(`Runtime returned ${response.status}`);
      }

      const data: CompanionResponse =
        (await response.json()) as CompanionResponse;

      const errorCode =
        typeof data.action?.error_code === "string" ? data.action.error_code : null;
      const responseIsPositive =
        data.ok ||
        data.loading ||
        data.action?.type === "permission_required" ||
        errorCode === "model_missing";
      await waitForPacing(getReplyThinkingDelay(data.assistant_response));
      appendCompanionMessage(data.assistant_response, responseIsPositive);
      if (
        data.action?.type === "chat_reply" &&
        typeof data.action.provider === "string" &&
        typeof data.action.model === "string" &&
        (data.loading || errorCode === "model_missing")
      ) {
        setModelStatus({
          provider: data.action.provider,
          model: data.action.model,
          state: data.loading ? "loading" : "missing",
          present: errorCode !== "model_missing",
          loaded: false,
          message: data.assistant_response,
        });
      }
      await handleResponseAction(data.action, userText);
    } catch {
      const packName = activePackRef.current?.display_name ?? DEFAULT_COMPANION_NAME;
      await waitForPacing(MIN_THINKING_DELAY_MS);
      appendCompanionMessage(
        `${packName} lost the local thread for a moment. Stay with me and try again in a breath.`,
        false,
      );
    } finally {
      setIsSending(false);
      isSendingRef.current = false;
    }
  }

  async function submitMessage(
    userText: string,
    options?: { appendUserMessage?: boolean; force?: boolean },
  ): Promise<void> {
    const trimmedText = userText.trim();
    if (!trimmedText || (isSendingRef.current && options?.force !== true)) {
      return;
    }

    setIsSending(true);
    isSendingRef.current = true;

    if (options?.appendUserMessage !== false) {
      appendMessage("user", trimmedText);
    }

    companionEventBus.emit("userMessageSent", { message: trimmedText });
    await sendMessageToRuntime(trimmedText);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedDraft = draft.trim();
    if (!trimmedDraft || isSending) {
      return;
    }

    setDraft("");
    draftRef.current = "";
    companionEventBus.emit("draftChanged", { draft: "" });
    await submitMessage(trimmedDraft);
  }

  function handleDraftChange(nextDraft: string): void {
    setDraft(nextDraft);
    companionEventBus.emit("draftChanged", { draft: nextDraft });
  }

  async function handleToggleUtilityNote(
    noteId: number,
    completed: boolean,
  ): Promise<void> {
    try {
      const updatedNote = await microUtilityApi.updateNote(noteId, { completed });
      await refreshMicroUtilitiesState();
      appendCompanionMessage(
        completed
          ? `I marked "${updatedNote.label}" as done.`
          : `I reopened "${updatedNote.label}" for you.`,
        true,
      );
      companionEventBus.emit("utilityActionCompleted", {
        action: "created_todo",
      });
    } catch {
      appendCompanionMessage(
        "I could not update that note just yet. Please try again in a moment.",
        false,
      );
    }
  }

  async function handleEditUtilityNote(
    noteId: number,
    currentLabel: string,
  ): Promise<void> {
    const nextLabel = window.prompt("Update this note", currentLabel)?.trim();
    if (!nextLabel || nextLabel === currentLabel) {
      return;
    }

    try {
      const updatedNote = await microUtilityApi.updateNote(noteId, {
        label: nextLabel,
      });
      await refreshMicroUtilitiesState();
      appendCompanionMessage(
        `I updated that note to "${updatedNote.label}".`,
        true,
      );
    } catch {
      appendCompanionMessage(
        "I could not update that note just yet. Please try again in a moment.",
        false,
      );
    }
  }

  async function handleDismissUtilityAlert(utilityId: number): Promise<void> {
    try {
      const result = await microUtilityApi.dismissAlert(utilityId);
      await refreshMicroUtilitiesState();
      appendCompanionMessage(result.message, true);
    } catch {
      appendCompanionMessage(
        "I could not dismiss that alert just yet. Please try again in a moment.",
        false,
      );
    }
  }

  const handlePacksChanged = useCallback(
    (packs: InstalledPack[], activePackId: string | null) => {
      setActivePack(packs.find((pack) => pack.id === activePackId) ?? null);
      void refreshVoiceStatus().catch(() => {});
      void refreshSpeechInputStatus().catch(() => {});
    },
    [refreshSpeechInputStatus, refreshVoiceStatus],
  );

  const companionTitle = useMemo(
    () => activePack?.display_name ?? DEFAULT_COMPANION_NAME,
    [activePack],
  );
  const avatarReadiness = useMemo(
    () => getAvatarReadiness(activePack),
    [activePack],
  );
  const runtimeReadinessLabel = installerCompleted
    ? "Runtime ready"
    : "Runtime needs attention";
  const modelReadinessLabel =
    modelStatus?.state === "ready"
      ? "Local model ready"
      : modelStatus?.state === "loading"
        ? "Local model warming"
        : modelStatus?.state === "missing"
          ? "Model needs download"
        : "Checking local model";
  const voiceReadinessLabel =
    voiceStatus?.state === "ready"
      ? "Voice ready"
      : voiceStatus?.state === "muted"
        ? "Voice muted"
        : voiceStatus?.state === "unavailable"
          ? "Voice unavailable"
          : "Checking voice";
  const voiceIdentityLabel =
    voiceStatus === null
      ? "Checking active voice profile."
      : `${voiceStatus.provider} / ${voiceStatus.voice_id}${
          voiceStatus.style ? ` / ${voiceStatus.style}` : ""
        }`;
  const speechInputReadinessLabel = getSpeechInputReadinessLabel(
    speechInputStatus,
    speechInputSupport,
    speechInputBrowserState,
  );
  const speechInputIdentityLabel =
    speechInputStatus === null
      ? "Checking speech input profile."
      : `${speechInputStatus.provider} / ${
          speechInputStatus.transcription_enabled ? "browser transcription" : "mic only"
        }`;
  const speechInputSupportLabel = getSpeechInputSupportLabel(
    speechInputStatus,
    speechInputSupport,
  );
  const presenceReadinessLabel =
    presenceStatus?.state === "click-through"
      ? "Pinned, click-through"
      : presenceStatus?.state === "pinned"
        ? "Pinned to desktop"
        : presenceStatus?.state === "workspace"
          ? "Workspace only"
          : "Checking presence";
  const presenceAnchorLabel =
    presenceStatus?.anchor === "desktop-left"
      ? "desktop left"
      : presenceStatus?.anchor === "active-window-left"
        ? "left of active app"
        : presenceStatus?.anchor === "active-window-right"
          ? "right of active app"
          : presenceStatus?.anchor === "active-window-top-left"
            ? "top-left of active app"
            : presenceStatus?.anchor === "active-window-top-right"
              ? "top-right of active app"
              : presenceStatus?.anchor === "desktop-right"
                ? "desktop right"
                : "workspace";
  const presenceAttachmentLabel = getPresenceAttachmentLabel(
    presenceStatus,
    presenceTarget?.title ?? null,
  );
  const presenceAttachmentDetail = getPresenceAttachmentDetail(
    presenceStatus,
    companionTitle,
    presenceTarget?.title ?? null,
  );
  const companionStateSummary =
    companionState === "idle"
      ? "Settled nearby and ready for the next small thing."
      : companionState === "listening"
        ? "Listening closely for where to pick the thread back up."
        : companionState === "thinking"
          ? "Holding the local thread while I work it through."
          : companionState === "talking"
            ? "Staying with you in the foreground."
            : companionState === "reaction"
              ? "Reacting to a timer, shortcut, or small cue."
              : "I need a little help from the local runtime.";
  const ambientDeskCue = getAmbientDeskCue(companionState, companionTitle);
  const showsStarterWelcome =
    messages.length === 1 &&
    messages[0]?.id === 1 &&
    messages[0]?.sender === "companion" &&
    messages[0]?.text === DEFAULT_STARTER_MESSAGE;
  const lastCompanionMessage = [...messages]
    .reverse()
    .find((message) => message.sender === "companion");
  const showsFollowUpDesk =
    !showsStarterWelcome && lastCompanionMessage !== undefined && !isSending;

  return (
    <main
      className={`app-shell${
        overlayActive && !isSettingsOpen
          ? " app-shell--overlay"
          : ""
      }`}
    >
      <section
        className={`stage-panel${
          overlayActive && !isSettingsOpen
            ? " stage-panel--overlay"
            : ""
        }`}
      >
        <div className="stage-panel__copy">
          <span className="eyebrow">Companion OS</span>
          <h1>{companionTitle} is awake.</h1>
          <p>
            A calm local companion for check-ins, useful actions, and one
            continuous thread you can pick up whenever the day gets noisy.
          </p>
          <div className="stage-panel__rail" aria-label="Companion readiness">
            <div className="stage-panel__rail-item">
              <span className="stage-panel__rail-label">Identity</span>
              <strong>{companionTitle}</strong>
            </div>
            <div className="stage-panel__rail-item">
              <span className="stage-panel__rail-label">Model</span>
              <strong>{modelReadinessLabel}</strong>
            </div>
            <div className="stage-panel__rail-item">
              <span className="stage-panel__rail-label">Runtime</span>
              <strong>{runtimeReadinessLabel}</strong>
            </div>
            <div className="stage-panel__rail-item">
              <span className="stage-panel__rail-label">Avatar</span>
              <strong>{avatarReadiness.label}</strong>
            </div>
            <div className="stage-panel__rail-item">
              <span className="stage-panel__rail-label">Ears</span>
              <strong>{speechInputReadinessLabel}</strong>
            </div>
            <div className="stage-panel__rail-item">
              <span className="stage-panel__rail-label">Voice</span>
              <strong>{voiceReadinessLabel}</strong>
            </div>
            <div className="stage-panel__rail-item">
              <span className="stage-panel__rail-label">Presence</span>
              <strong>{presenceReadinessLabel}</strong>
            </div>
          </div>
          <div className="stage-panel__presence" aria-label="Companion qualities">
            <span>Local-first replies</span>
            <span>Useful desk actions</span>
            <span>One steady thread</span>
          </div>
          <div className="stage-panel__attachment" aria-label="Presence attachment">
            <strong>{presenceAttachmentLabel}</strong>
            <span>{presenceAttachmentDetail}</span>
          </div>
          <p className="stage-panel__note">
            <strong>Right now</strong>
            <span>{companionStateSummary}</span>
          </p>
          <p className="stage-panel__ambient" aria-live="polite">
            <strong>Desk tone</strong>
            <span>{ambientDeskCue}</span>
          </p>
        </div>
        {activeStreamEvent ? (
          <article className="stream-bubble" aria-live="polite">
            <span className="eyebrow">
              {activeStreamEvent.provider === "twitch" ? "Twitch" : "YouTube"}
            </span>
            <p>{activeStreamEvent.bubble_text}</p>
          </article>
        ) : null}
        <CompanionAvatar
          state={companionState}
          displayName={companionTitle}
          avatarConfig={activePack?.avatar}
          modelConfig={activePack?.model}
          iconDataUrl={activePack?.icon_data_url}
          presenceAnchor={presenceStatus?.anchor}
          presencePinned={desktopPresencePinned}
          presenceTargetTitle={presenceTarget?.title}
          voiceConfig={activePack?.voice}
        />
      </section>

      <aside className="chat-panel">
        <div className="chat-panel__header">
          <div className="chat-panel__header-copy">
            <span className="eyebrow">Conversation</span>
            <h2>Stay in step with {companionTitle}</h2>
            <p>
              Ask for help, start something useful, or pick up the thread
              without losing the feeling that the companion is still nearby.
            </p>
          </div>
          <div className="chat-panel__header-actions">
            <button
              className="settings-toggle-button"
              type="button"
              onClick={() => {
                setIsSettingsOpen((currentValue) => !currentValue);
              }}
            >
              {isSettingsOpen ? "Close settings" : "Settings"}
            </button>
            <div className={`status-pill status-pill--${companionState}`}>
              {companionState}
            </div>
          </div>
        </div>

        {isSettingsOpen ? (
          <section className="settings-panel" aria-label="Companion settings">
            <div className="settings-panel__header">
              <div>
                <span className="eyebrow">Settings</span>
                <h3>Continuity and repair</h3>
              </div>
              <span
                className={`settings-health settings-health--${
                  installerCompleted ? "ready" : "needs-attention"
                }`}
              >
                {installerCompleted ? "OpenClaw ready" : "OpenClaw needs attention"}
              </span>
            </div>

            <div className="settings-panel__grid">
              <article className="settings-card">
                <span className="settings-card__label">Selected pack</span>
                <strong>{companionTitle}</strong>
                <p>
                  The active pack keeps this companion&apos;s tone, idle motion, and
                  voice cues consistent after restarts.
                </p>
              </article>

              <article className="settings-card">
                <span className="settings-card__label">Avatar profile</span>
                <strong>{avatarReadiness.label}</strong>
                <p>{avatarReadiness.detail}</p>
                <p>
                  {activePack?.model?.renderer === "live2d"
                    ? "This pack already carries a Live2D manifest for the next rendering step."
                    : activePack?.model?.renderer === "vrm"
                      ? "This pack already carries a VRM manifest for the next rendering step."
                      : activePack?.avatar?.presentation_mode === "model" ||
                          activePack?.avatar?.model_path
                        ? "This pack already carries a model path for the next rendering step."
                    : activePack?.icon_data_url
                      ? "This pack is already carrying portrait art for the shell."
                      : "This companion is still using the built-in shell presentation."}
                </p>
                <p>{getModelManifestSummary(activePack)}</p>
              </article>

              <article className="settings-card">
                <span className="settings-card__label">Selected model</span>
                <strong>{selectedModel}</strong>
                <p>Core replies stay local-first with your saved model choice.</p>
                <label className="settings-select">
                  <span>Choose local model</span>
                  <select
                    aria-label="Choose local model"
                    value={selectedModel}
                    onChange={(event) => {
                      setSelectedModel(event.target.value);
                    }}
                  >
                    {availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="settings-action-button"
                  disabled={isSavingModel}
                  type="button"
                  onClick={() => {
                    void handleSaveModelSelection();
                  }}
                >
                  {isSavingModel ? "Saving model..." : "Save model"}
                </button>
                <p>
                  {modelStatus?.state === "ready"
                    ? "Ready locally."
                    : modelStatus?.state === "loading"
                      ? "Warming up locally."
                      : modelStatus?.state === "missing"
                        ? "Needs download or a different local model."
                        : "Checking local model status."}
                </p>
              </article>

              <article className="settings-card">
                <span className="settings-card__label">Permissions</span>
                <p>
                  App launches:{" "}
                  <strong>{hasOpenAppPermission ? "Allowed" : "Not allowed"}</strong>
                </p>
                <p>
                  Browser access:{" "}
                  <strong>{hasOpenUrlPermission ? "Allowed" : "Not allowed"}</strong>
                </p>
              </article>

              <article className="settings-card">
                <span className="settings-card__label">Voice</span>
                <strong>{voiceReadinessLabel}</strong>
                <p>{voiceStatus?.message ?? "Checking voice readiness for this companion."}</p>
                <p>{voiceIdentityLabel}</p>
                <button
                  className="settings-action-button"
                  disabled={isSavingVoice}
                  type="button"
                  onClick={() => {
                    void handleToggleVoiceEnabled(!(voiceStatus?.enabled ?? true));
                  }}
                >
                  {isSavingVoice
                    ? "Saving voice..."
                    : voiceStatus?.enabled === false
                      ? "Turn voice back on"
                      : "Mute voice for now"}
                </button>
              </article>

              <article className="settings-card">
                <span className="settings-card__label">Speech input</span>
                <strong>{speechInputReadinessLabel}</strong>
                <p>{speechInputStatus?.message ?? "Checking speech input readiness."}</p>
                <p>{speechInputIdentityLabel}</p>
                <p>{speechInputSupportLabel}</p>
                {speechInputDraft ? (
                  <p>Latest local draft: "{speechInputDraft}"</p>
                ) : null}
                <label className="settings-toggle">
                  <input
                    checked={speechInputStatus?.enabled ?? false}
                    disabled={isSavingSpeechInput}
                    type="checkbox"
                    onChange={(event) => {
                      void handleToggleSpeechInputEnabled(event.target.checked);
                    }}
                  />
                  <span>Turn speech input on</span>
                </label>
                <label className="settings-toggle">
                  <input
                    checked={speechInputStatus?.transcription_enabled ?? true}
                    disabled={
                      isSavingSpeechInput || !(speechInputStatus?.enabled ?? false)
                    }
                    type="checkbox"
                    onChange={(event) => {
                      void handleToggleSpeechTranscription(event.target.checked);
                    }}
                  />
                  <span>Use browser transcription when available</span>
                </label>
                <button
                  className="settings-action-button"
                  disabled={
                    isSavingSpeechInput ||
                    !(speechInputStatus?.enabled ?? false) ||
                    !speechInputSupport.microphone
                  }
                  type="button"
                  onClick={() => {
                    void handleSpeechInputSessionToggle();
                  }}
                >
                  {speechInputSessionRef.current !== null
                    ? "Stop mic check"
                    : "Start mic check"}
                </button>
              </article>

              <article className="settings-card">
                <span className="settings-card__label">Desktop presence</span>
                <strong>{presenceReadinessLabel}</strong>
                <p>
                  {presenceStatus?.message ??
                    "Checking whether Aster is staying in the workspace or pinned above the desktop."}
                </p>
                <p>Anchor: {presenceAnchorLabel}</p>
                <p>{presenceAttachmentDetail}</p>
                <label className="settings-toggle">
                  <input
                    checked={presenceStatus?.enabled ?? false}
                    disabled={isSavingPresence}
                    type="checkbox"
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void handleSavePresenceSettings({
                        enabled,
                        click_through_enabled: enabled
                          ? presenceStatus?.click_through_enabled
                          : false,
                        anchor:
                          enabled && (presenceStatus?.anchor ?? "workspace") === "workspace"
                            ? "desktop-right"
                            : presenceStatus?.anchor,
                      });
                    }}
                  />
                  <span>Pin Aster above the desktop</span>
                </label>
                <label className="settings-toggle">
                  <input
                    checked={presenceStatus?.click_through_enabled ?? false}
                    disabled={isSavingPresence || !(presenceStatus?.enabled ?? false)}
                    type="checkbox"
                    onChange={(event) => {
                      void handleSavePresenceSettings({
                        click_through_enabled: event.target.checked,
                      });
                    }}
                  />
                  <span>Let clicks pass through when pinned</span>
                </label>
                <label className="settings-select">
                  <span>Choose desktop presence anchor</span>
                  <select
                    aria-label="Choose desktop presence anchor"
                    disabled={isSavingPresence}
                    value={presenceStatus?.anchor ?? "desktop-right"}
                    onChange={(event) => {
                      const nextAnchor = event.target.value as PresenceStatus["anchor"];
                      void handleSavePresenceSettings({
                        anchor: nextAnchor,
                        enabled:
                          nextAnchor === "workspace"
                            ? false
                            : (presenceStatus?.enabled ?? false),
                        click_through_enabled:
                          nextAnchor === "workspace"
                            ? false
                            : presenceStatus?.click_through_enabled,
                      });
                    }}
                  >
                    <option value="desktop-right">Desktop right</option>
                    <option value="desktop-left">Desktop left</option>
                    <option value="active-window-right">Right of active app</option>
                    <option value="active-window-left">Left of active app</option>
                    <option value="active-window-top-right">Top-right of active app</option>
                    <option value="active-window-top-left">Top-left of active app</option>
                    <option value="workspace">Workspace only</option>
                  </select>
                </label>
              </article>
            </div>

            <div className="settings-actions">
              <button
                className="settings-action-button"
                type="button"
                onClick={() => {
                  void handleResetChatHistory();
                }}
              >
                Reset chat history
              </button>
              <button
                className="settings-action-button"
                type="button"
                onClick={() => {
                  void handleResetPermissions();
                }}
              >
                Reset permissions
              </button>
              <button
                className="settings-action-button settings-action-button--primary"
                disabled={isRepairingOpenClaw}
                type="button"
                onClick={() => {
                  void handleRepairOpenClaw();
                }}
              >
                {isRepairingOpenClaw ? "Repairing OpenClaw..." : "Repair OpenClaw"}
              </button>
            </div>

            {settingsNotice ? (
              <p className="settings-notice" role="status">
                {settingsNotice}
              </p>
            ) : null}

            <MemoryPrivacySettings />
            <PersonalityPackSettings onPacksChanged={handlePacksChanged} />
            <StreamIntegrationSettings
              isSaving={isSavingStreamSettings}
              notice={streamNotice}
              recentEvents={streamState?.recent_events ?? []}
              settings={streamState?.settings ?? null}
              onClearEvents={handleClearStreamEvents}
              onPreview={handlePreviewStreamEvent}
              onSave={handleSaveStreamSettings}
            />
          </section>
        ) : null}

        <MicroUtilitiesPanel
          isBusy={
            isSending ||
            isLoadingUtilities ||
            isLoadingOpenAppPermission ||
            isLoadingOpenUrlPermission
          }
          state={microUtilityState}
          onSetTimer={() => {
            void submitMessage("set a 5 minute timer");
          }}
          onSaveClipboard={() => {
            void submitMessage("save clipboard");
          }}
          onShowTodos={() => {
            void submitMessage("show my todo list");
          }}
          onDismissAlert={(utilityId) => {
            void handleDismissUtilityAlert(utilityId);
          }}
          onEditNote={(noteId, currentLabel) => {
            void handleEditUtilityNote(noteId, currentLabel);
          }}
          onRunShortcut={(shortcutId) => {
            void submitMessage(`run shortcut ${shortcutId}`);
          }}
          onToggleNote={(noteId, completed) => {
            void handleToggleUtilityNote(noteId, completed);
          }}
        />

        <section className="conversation-shell" aria-label="Conversation surface">
          <div className="conversation-shell__header">
            <div>
              <span className="eyebrow">Recent exchange</span>
              <h3>{companionTitle} keeps the thread steady</h3>
            </div>
            <span className="conversation-shell__status">{companionStateSummary}</span>
          </div>

          {showsStarterWelcome ? (
            <article className="welcome-desk" aria-label="First hello">
              <span className="eyebrow">First hello</span>
              <h4>Start small with {companionTitle}.</h4>
              <p>
                Ask for a quick check-in, open something you use often, or let
                {` ${companionTitle}`} keep a quiet note while you get settled.
              </p>
              <div className="welcome-desk__list" aria-label="Suggested ways to begin">
                <span>Ask a small question</span>
                <span>Open something familiar</span>
                <span>Set a timer or save a note</span>
              </div>
              <div className="welcome-desk__meta">
                <span>{selectedModel}</span>
                <span>{runtimeReadinessLabel}</span>
                <span>{voiceReadinessLabel}</span>
              </div>
            </article>
          ) : null}

          <div className="message-list" role="log" aria-live="polite">
            {messages.map((message) => (
              <article
                className={`message message--${message.sender}`}
                key={message.id}
              >
                <span className="message__sender">
                  {message.sender === "companion" ? companionTitle : "You"}
                </span>
                <p>{message.text}</p>
              </article>
            ))}
          </div>

          {showsFollowUpDesk ? (
            <article className="follow-up-desk" aria-label="Next with Aster">
              <div className="follow-up-desk__copy">
                <span className="eyebrow">Next with {companionTitle}</span>
                <p>Keep the same thread going, or hand me the next small thing.</p>
              </div>
              <div className="follow-up-desk__actions">
                <button
                  className="quick-action-button"
                  disabled={isSending}
                  type="button"
                  onClick={() => {
                    void submitMessage("show my todo list");
                  }}
                >
                  Show my notes
                </button>
                <button
                  className="quick-action-button"
                  disabled={isSending}
                  type="button"
                  onClick={() => {
                    void submitMessage("set a 5 minute timer");
                  }}
                >
                  Set another timer
                </button>
                <button
                  className="quick-action-button"
                  disabled={isSending || isLoadingOpenAppPermission}
                  type="button"
                  onClick={() => {
                    void submitMessage("open Spotify");
                  }}
                >
                  Open Spotify
                </button>
              </div>
            </article>
          ) : null}

          <div className="quick-actions">
            <button
              className="quick-action-button quick-action-button--primary"
              disabled={isSending}
              type="button"
              onClick={() => {
                void submitMessage("How can we start today?");
              }}
            >
              Check in with {companionTitle}
            </button>
            <button
              className="quick-action-button"
              disabled={isSending}
              type="button"
              onClick={() => {
                void submitMessage("set a 5 minute timer");
              }}
            >
              Set a 5 minute timer
            </button>
            <button
              className="quick-action-button"
              disabled={isSending || isLoadingOpenAppPermission}
              type="button"
              onClick={() => {
                void submitMessage("open Spotify");
              }}
            >
              Open Spotify
            </button>
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <label className="composer__label" htmlFor="chat-input">
              Write to {companionTitle}. The thread stays local and picks up where
              you left it.
            </label>
            <textarea
              id="chat-input"
              className="composer__input"
              placeholder={`Ask ${companionTitle} for help, a timer, an app, or a small check-in...`}
              rows={4}
              value={draft}
              disabled={isSending}
              onChange={(event) => handleDraftChange(event.target.value)}
            />
            <button
              className="composer__submit"
              disabled={isSending}
              type="submit"
            >
              {isSending ? "Waiting for reply..." : "Send message"}
            </button>
          </form>
        </section>
      </aside>
    </main>
  );
}
