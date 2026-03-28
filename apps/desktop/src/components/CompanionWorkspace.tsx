import { FormEvent, useEffect, useRef, useState } from "react";

import {
  clearCompanionSession,
  loadCompanionSession,
  persistCompanionSession,
  type CompanionMessage,
} from "../companionSession";
import { companionEventBus } from "../eventBus";
import { installerApi } from "../installerApi";
import { CompanionAvatar, type CompanionState } from "./CompanionAvatar";

type CompanionResponse = {
  ok: boolean;
  route: string;
  user_message: string;
  assistant_response: string;
  action?: Record<string, unknown> | null;
};

type OpenAppResponse = {
  ok: boolean;
  app: string;
  message: string;
};

type BrowserHelperResponse = {
  ok: boolean;
  action: string;
  request: string;
  url: string;
  message: string;
};

type PermissionResponse = {
  permission: string;
  granted: boolean;
};

const starterMessages: CompanionMessage[] = [
  {
    id: 1,
    sender: "companion",
    text: "Installation complete. I am awake on the local runtime and ready to help.",
  },
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

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
  const [selectedModel, setSelectedModel] = useState("llama3.1:8b-instruct");
  const [installerCompleted, setInstallerCompleted] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [isRepairingOpenClaw, setIsRepairingOpenClaw] = useState(false);
  const nextMessageIdRef = useRef(2);
  const draftRef = useRef("");
  const isSendingRef = useRef(false);
  const isWindowFocusedRef = useRef(document.hasFocus());
  const talkingTimerRef = useRef<number | null>(null);

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
        const [openAppResponse, openUrlResponse, installerStatus] = await Promise.all([
          fetch(`${API_BASE_URL}/api/preferences/permissions/open_app`),
          fetch(`${API_BASE_URL}/api/preferences/permissions/open_url`),
          installerApi.getInstallerStatus(),
        ]);

        if (!openAppResponse.ok || !openUrlResponse.ok) {
          throw new Error("Runtime returned an unexpected permissions response");
        }

        const [openAppData, openUrlData] = (await Promise.all([
          openAppResponse.json(),
          openUrlResponse.json(),
        ])) as [PermissionResponse, PermissionResponse];

        if (!active) {
          return;
        }

        setHasOpenAppPermission(openAppData.granted);
        setHasOpenUrlPermission(openUrlData.granted);
        setSelectedModel(installerStatus.ai.model);
        setInstallerCompleted(installerStatus.completed);
      } catch {
        if (!active) {
          return;
        }

        setHasOpenAppPermission(false);
        setHasOpenUrlPermission(false);
        setInstallerCompleted(false);
      } finally {
        if (active) {
          setIsLoadingOpenAppPermission(false);
          setIsLoadingOpenUrlPermission(false);
        }
      }
    }

    void loadWorkspaceState();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function clearTalkingTimer(): void {
      if (talkingTimerRef.current !== null) {
        window.clearTimeout(talkingTimerRef.current);
        talkingTimerRef.current = null;
      }
    }

    function settleCompanionState(): void {
      if (!isWindowFocusedRef.current) {
        setCompanionState("idle");
        return;
      }

      setCompanionState(
        draftRef.current.trim().length > 0 ? "listening" : "idle",
      );
    }

    function startTalkingState(): void {
      clearTalkingTimer();
      setCompanionState("talking");
      talkingTimerRef.current = window.setTimeout(() => {
        talkingTimerRef.current = null;
        settleCompanionState();
      }, 1400);
    }

    function startErrorState(): void {
      clearTalkingTimer();
      setCompanionState("error");
      talkingTimerRef.current = window.setTimeout(() => {
        talkingTimerRef.current = null;
        settleCompanionState();
      }, 1800);
    }

    const unsubscribeDraftChanged = companionEventBus.subscribe(
      "draftChanged",
      ({ payload }) => {
        draftRef.current = payload.draft;

        if (isSendingRef.current) {
          return;
        }

        clearTalkingTimer();
        settleCompanionState();
      },
    );

    const unsubscribeUserMessageSent = companionEventBus.subscribe(
      "userMessageSent",
      () => {
        clearTalkingTimer();
        setCompanionState("thinking");
      },
    );

    const unsubscribeResponseReceived = companionEventBus.subscribe(
      "responseReceived",
      ({ payload }) => {
        if (payload.ok) {
          startTalkingState();
          return;
        }

        startErrorState();
      },
    );

    const unsubscribeWindowFocusChanged = companionEventBus.subscribe(
      "windowFocusChanged",
      ({ payload }) => {
        isWindowFocusedRef.current = payload.focused;

        if (isSendingRef.current || talkingTimerRef.current !== null) {
          return;
        }

        settleCompanionState();
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
      clearTalkingTimer();
      unsubscribeDraftChanged();
      unsubscribeUserMessageSent();
      unsubscribeResponseReceived();
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

  function appendCompanionMessage(text: string, ok: boolean): void {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: nextMessageId(),
        sender: "companion",
        text,
      },
    ]);
    companionEventBus.emit("responseReceived", {
      message: text,
      ok,
    });
  }

  async function persistOpenAppPermission(granted: boolean): Promise<boolean> {
    const response = await fetch(
      `${API_BASE_URL}/api/preferences/permissions/open_app`,
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
    setHasOpenAppPermission(data.granted);
    return data.granted;
  }

  async function persistOpenUrlPermission(granted: boolean): Promise<boolean> {
    const response = await fetch(
      `${API_BASE_URL}/api/preferences/permissions/open_url`,
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
    setHasOpenUrlPermission(data.granted);
    return data.granted;
  }

  async function refreshWorkspaceSettings(): Promise<void> {
    const [openAppResponse, openUrlResponse, installerStatus] = await Promise.all([
      fetch(`${API_BASE_URL}/api/preferences/permissions/open_app`),
      fetch(`${API_BASE_URL}/api/preferences/permissions/open_url`),
      installerApi.getInstallerStatus(),
    ]);

    if (!openAppResponse.ok || !openUrlResponse.ok) {
      throw new Error("Runtime returned an unexpected settings response");
    }

    const [openAppData, openUrlData] = (await Promise.all([
      openAppResponse.json(),
      openUrlResponse.json(),
    ])) as [PermissionResponse, PermissionResponse];

    setHasOpenAppPermission(openAppData.granted);
    setHasOpenUrlPermission(openUrlData.granted);
    setSelectedModel(installerStatus.ai.model);
    setInstallerCompleted(installerStatus.completed);
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
        persistOpenAppPermission(false),
        persistOpenUrlPermission(false),
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
        `I could not repair OpenClaw yet: ${detail}`,
        false,
      );
      setSettingsNotice(`OpenClaw still needs attention: ${detail}`);
    } finally {
      setIsRepairingOpenClaw(false);
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

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: nextMessageId(),
          sender: "companion",
          text: data.assistant_response,
        },
      ]);
      companionEventBus.emit("responseReceived", {
        message: data.assistant_response,
        ok: data.ok,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown connection error";
      const fallbackMessage = `I could not reach the runtime: ${detail}`;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: nextMessageId(),
          sender: "companion",
          text: fallbackMessage,
        },
      ]);
      companionEventBus.emit("responseReceived", {
        message: fallbackMessage,
        ok: false,
      });
    } finally {
      setIsSending(false);
      isSendingRef.current = false;
    }
  }

  async function openApp(appName: "spotify" | "discord"): Promise<void> {
    if (isSending || isLoadingOpenAppPermission) {
      return;
    }

    if (!hasOpenAppPermission) {
      const confirmed = window.confirm(
        `Allow Companion OS to launch ${appName === "spotify" ? "Spotify" : "Discord"}?`,
      );

      if (!confirmed) {
        return;
      }

      try {
        await persistOpenAppPermission(true);
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Unknown permission error";
        const permissionMessage = `I could not save the open_app permission: ${detail}`;

        setMessages((currentMessages) => [
          ...currentMessages,
          {
            id: nextMessageId(),
            sender: "companion",
            text: permissionMessage,
          },
        ]);
        companionEventBus.emit("responseReceived", {
          message: permissionMessage,
          ok: false,
        });
        return;
      }
    }

    setIsSending(true);
    isSendingRef.current = true;

    const userMessage =
      appName === "spotify" ? "Open Spotify" : "Open Discord";

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: nextMessageId(),
        sender: "user",
        text: userMessage,
      },
    ]);
    companionEventBus.emit("userMessageSent", { message: userMessage });

    try {
      const response = await fetch(`${API_BASE_URL}/api/skills/open-app`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ app: appName }),
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;

        if (response.status === 403) {
          setHasOpenAppPermission(false);
        }

        throw new Error(
          errorPayload?.detail ?? `Runtime returned ${response.status}`,
        );
      }

      const data: OpenAppResponse = (await response.json()) as OpenAppResponse;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: nextMessageId(),
          sender: "companion",
          text: data.message,
        },
      ]);
      companionEventBus.emit("responseReceived", {
        message: data.message,
        ok: data.ok,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown launch error";
      const fallbackMessage = `I could not open ${appName}: ${detail}`;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: nextMessageId(),
          sender: "companion",
          text: fallbackMessage,
        },
      ]);
      companionEventBus.emit("responseReceived", {
        message: fallbackMessage,
        ok: false,
      });
    } finally {
      setIsSending(false);
      isSendingRef.current = false;
    }
  }

  async function runBrowserHelper(requestText: string): Promise<void> {
    if (isSending || isLoadingOpenUrlPermission) {
      return;
    }

    if (!hasOpenUrlPermission) {
      const confirmed = window.confirm(
        "Allow Companion OS to open links and searches in your default browser?",
      );

      if (!confirmed) {
        return;
      }

      try {
        await persistOpenUrlPermission(true);
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Unknown permission error";
        const permissionMessage = `I could not save browser access: ${detail}`;

        setMessages((currentMessages) => [
          ...currentMessages,
          {
            id: nextMessageId(),
            sender: "companion",
            text: permissionMessage,
          },
        ]);
        companionEventBus.emit("responseReceived", {
          message: permissionMessage,
          ok: false,
        });
        return;
      }
    }

    setIsSending(true);
    isSendingRef.current = true;

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: nextMessageId(),
        sender: "user",
        text: requestText,
      },
    ]);
    companionEventBus.emit("userMessageSent", { message: requestText });

    try {
      const response = await fetch(`${API_BASE_URL}/api/skills/browser-helper`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ request: requestText }),
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;

        if (response.status === 403) {
          setHasOpenUrlPermission(false);
        }

        throw new Error(
          errorPayload?.detail ?? `Runtime returned ${response.status}`,
        );
      }

      const data: BrowserHelperResponse =
        (await response.json()) as BrowserHelperResponse;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: nextMessageId(),
          sender: "companion",
          text: data.message,
        },
      ]);
      companionEventBus.emit("responseReceived", {
        message: data.message,
        ok: data.ok,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown browser error";
      const fallbackMessage = `I could not use the browser helper: ${detail}`;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: nextMessageId(),
          sender: "companion",
          text: fallbackMessage,
        },
      ]);
      companionEventBus.emit("responseReceived", {
        message: fallbackMessage,
        ok: false,
      });
    } finally {
      setIsSending(false);
      isSendingRef.current = false;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedDraft = draft.trim();
    if (!trimmedDraft || isSending) {
      return;
    }

    setIsSending(true);
    isSendingRef.current = true;

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: nextMessageId(),
        sender: "user",
        text: trimmedDraft,
      },
    ]);
    setDraft("");
    draftRef.current = "";
    companionEventBus.emit("draftChanged", { draft: "" });
    companionEventBus.emit("userMessageSent", { message: trimmedDraft });
    await sendMessageToRuntime(trimmedDraft);
  }

  function handleDraftChange(nextDraft: string): void {
    setDraft(nextDraft);
    companionEventBus.emit("draftChanged", { draft: nextDraft });
  }

  return (
    <main className="app-shell">
      <section className="stage-panel">
        <div className="stage-panel__copy">
          <span className="eyebrow">Companion OS</span>
          <h1>One companion, shifting state with your attention.</h1>
          <p>
            The desktop shell now follows a simple state machine: idle when the
            room is quiet, listening while you type, thinking while the runtime
            works, talking when a reply comes back, and briefly shifting into
            error when the local model needs attention.
          </p>
        </div>
        <CompanionAvatar state={companionState} />
      </section>

      <aside className="chat-panel">
        <div className="chat-panel__header">
          <div>
            <span className="eyebrow">Console</span>
            <h2>Local companion chat</h2>
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
                <span className="settings-card__label">Selected model</span>
                <strong>{selectedModel}</strong>
                <p>Core replies stay local-first with your saved model choice.</p>
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
          </section>
        ) : null}

        <div className="message-list" role="log" aria-live="polite">
          {messages.map((message) => (
            <article
              className={`message message--${message.sender}`}
              key={message.id}
            >
              <span className="message__sender">
                {message.sender === "companion" ? "Companion" : "You"}
              </span>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        <div className="quick-actions">
          <button
            className="quick-action-button"
            disabled={isSending || isLoadingOpenAppPermission}
            type="button"
            onClick={() => {
              void openApp("spotify");
            }}
          >
            Open Spotify
          </button>
          <button
            className="quick-action-button"
            disabled={isSending || isLoadingOpenUrlPermission}
            type="button"
            onClick={() => {
              void runBrowserHelper("search for Companion OS local setup");
            }}
          >
            Search Companion OS
          </button>
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <label className="composer__label" htmlFor="chat-input">
            Type a message and send it to the FastAPI runtime.
          </label>
          <textarea
            id="chat-input"
            className="composer__input"
            placeholder="Ask the companion to do something..."
            rows={4}
            value={draft}
            disabled={isSending}
            onChange={(event) => handleDraftChange(event.target.value)}
          />
          <button className="composer__submit" disabled={isSending} type="submit">
            {isSending ? "Waiting for reply..." : "Send message"}
          </button>
        </form>
      </aside>
    </main>
  );
}
