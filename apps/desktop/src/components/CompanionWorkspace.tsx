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
import { applyOverlayWindowState } from "../overlayController";
import {
  microUtilityApi,
  type MicroUtilityState,
} from "../microUtilityApi";
import { packApi, type InstalledPack } from "../packApi";
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

const DEFAULT_COMPANION_NAME = "Aster";
const DEFAULT_STARTER_MESSAGE =
  "I am here, awake locally, and ready to keep the desk steady with you.";
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
          installerStatus,
          installerModels,
          packResponse,
          utilityState,
          currentStreamState,
          modelStatusResponse,
        ] = await Promise.all([
          fetch(`${API_BASE_URL}/api/preferences/permissions/open_app`),
          fetch(`${API_BASE_URL}/api/preferences/permissions/open_url`),
          installerApi.getInstallerStatus(),
          installerApi.getModels().catch(() => []),
          packApi.listPacks(),
          microUtilityApi.getState(),
          streamApi.getState(),
          fetch(`${API_BASE_URL}/api/chat/model-status`),
        ]);

        if (!openAppResponse.ok || !openUrlResponse.ok || !modelStatusResponse.ok) {
          throw new Error("Runtime returned an unexpected permissions response");
        }

        const [openAppData, openUrlData, nextModelStatus] = (await Promise.all([
          openAppResponse.json(),
          openUrlResponse.json(),
          modelStatusResponse.json(),
        ])) as [PermissionResponse, PermissionResponse, ChatModelStatus];

        if (!active) {
          return;
        }

        setHasOpenAppPermission(openAppData.granted);
        setHasOpenUrlPermission(openUrlData.granted);
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
    if (streamState === null) {
      return;
    }

    void applyOverlayWindowState(streamState.settings);
  }, [streamState]);

  useEffect(() => {
    if (streamState?.settings.click_through_enabled !== true) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setStreamNotice("Overlay click-through was turned off.");
      void (async () => {
        try {
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
        } catch {
          setStreamNotice("I could not turn click-through off yet.");
        }
      })();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [streamState?.settings.click_through_enabled]);

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
      installerStatus,
      installerModels,
      packResponse,
      utilityState,
      nextStreamState,
      modelStatusResponse,
    ] = await Promise.all([
      fetch(`${API_BASE_URL}/api/preferences/permissions/open_app`),
      fetch(`${API_BASE_URL}/api/preferences/permissions/open_url`),
      installerApi.getInstallerStatus(),
      installerApi.getModels().catch(() => []),
      packApi.listPacks(),
      microUtilityApi.getState(),
      streamApi.getState(),
      fetch(`${API_BASE_URL}/api/chat/model-status`),
    ]);

    if (!openAppResponse.ok || !openUrlResponse.ok || !modelStatusResponse.ok) {
      throw new Error("Runtime returned an unexpected settings response");
    }

    const [openAppData, openUrlData, nextModelStatus] = (await Promise.all([
      openAppResponse.json(),
      openUrlResponse.json(),
      modelStatusResponse.json(),
    ])) as [PermissionResponse, PermissionResponse, ChatModelStatus];

    setHasOpenAppPermission(openAppData.granted);
    setHasOpenUrlPermission(openUrlData.granted);
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
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown model save error";
      setSettingsNotice(`I could not save that model yet: ${detail}`);
    } finally {
      setIsSavingModel(false);
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
      action.type === "shortcut_executed"
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
        `${packName} is having trouble reaching the local runtime right now. Please try again in a moment.`,
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
    },
    [],
  );

  const companionTitle = useMemo(
    () => activePack?.display_name ?? DEFAULT_COMPANION_NAME,
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
  const companionStateSummary =
    companionState === "idle"
      ? "Calm and ready to stay nearby."
      : companionState === "listening"
        ? "Listening for the next thing you need."
        : companionState === "thinking"
          ? "Working through the local runtime."
          : companionState === "talking"
            ? "Answering in the foreground."
            : companionState === "reaction"
              ? "Reacting to a timer, shortcut, or cue."
              : "Needs a little help from the local runtime.";
  const showsStarterWelcome =
    messages.length === 1 &&
    messages[0]?.id === 1 &&
    messages[0]?.sender === "companion" &&
    messages[0]?.text === DEFAULT_STARTER_MESSAGE;

  return (
    <main
      className={`app-shell${
        streamState?.settings.overlay_enabled && !isSettingsOpen
          ? " app-shell--overlay"
          : ""
      }`}
    >
      <section
        className={`stage-panel${
          streamState?.settings.overlay_enabled && !isSettingsOpen
            ? " stage-panel--overlay"
            : ""
        }`}
      >
        <div className="stage-panel__copy">
          <span className="eyebrow">Companion OS</span>
          <h1>{companionTitle} stays close.</h1>
          <p>
            One local companion, one continuous thread of conversation, and one
            desk for quiet help, useful actions, and small reactions throughout
            the day.
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
          </div>
          <p className="stage-panel__note">{companionStateSummary}</p>
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
              <h3>{companionTitle} keeps the thread warm</h3>
            </div>
            <span className="conversation-shell__status">{companionStateSummary}</span>
          </div>

          {showsStarterWelcome ? (
            <article className="welcome-desk" aria-label="First hello">
              <span className="eyebrow">First hello</span>
              <h4>{companionTitle} is here and ready.</h4>
              <p>
                Start with a small question, ask for something useful, or let
                {` ${companionTitle}`} settle in beside you for a moment.
              </p>
              <div className="welcome-desk__meta">
                <span>{selectedModel}</span>
                <span>{runtimeReadinessLabel}</span>
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

          <div className="quick-actions">
            <button
              className="quick-action-button quick-action-button--primary"
              disabled={isSending}
              type="button"
              onClick={() => {
                void submitMessage("How can we start today?");
              }}
            >
              How can we start?
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
            <button
              className="quick-action-button"
              disabled={isSending || isLoadingOpenUrlPermission}
              type="button"
              onClick={() => {
                void submitMessage("search for Companion OS local setup");
              }}
            >
              Search Companion OS
            </button>
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <label className="composer__label" htmlFor="chat-input">
              Write to {companionTitle} and keep the local thread moving.
            </label>
            <textarea
              id="chat-input"
              className="composer__input"
              placeholder={`Ask ${companionTitle} for help, a task, or a small check-in...`}
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
