import { FormEvent, useEffect, useRef, useState } from "react";

import { companionEventBus } from "../eventBus";
import { CompanionAvatar, type CompanionState } from "./CompanionAvatar";

type Message = {
  id: number;
  sender: "companion" | "user";
  text: string;
};

type OpenAppResponse = {
  ok: boolean;
  app: string;
  message: string;
};

type PermissionResponse = {
  permission: string;
  granted: boolean;
};

const starterMessages: Message[] = [
  {
    id: 1,
    sender: "companion",
    text: "Installation complete. I am awake on the local runtime and ready to help.",
  },
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export function CompanionWorkspace() {
  const [companionState, setCompanionState] = useState<CompanionState>("idle");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [isSending, setIsSending] = useState(false);
  const [hasOpenAppPermission, setHasOpenAppPermission] = useState(false);
  const [isLoadingOpenAppPermission, setIsLoadingOpenAppPermission] =
    useState(true);
  const nextMessageIdRef = useRef(2);
  const draftRef = useRef("");
  const isSendingRef = useRef(false);
  const isWindowFocusedRef = useRef(document.hasFocus());
  const talkingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    let active = true;

    async function loadOpenAppPermission(): Promise<void> {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/preferences/permissions/open_app`,
        );

        if (!response.ok) {
          throw new Error(`Runtime returned ${response.status}`);
        }

        const data: PermissionResponse =
          (await response.json()) as PermissionResponse;

        if (!active) {
          return;
        }

        setHasOpenAppPermission(data.granted);
      } catch {
        if (!active) {
          return;
        }

        setHasOpenAppPermission(false);
      } finally {
        if (active) {
          setIsLoadingOpenAppPermission(false);
        }
      }
    }

    void loadOpenAppPermission();

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
      () => {
        startTalkingState();
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

  function nextMessageId(): number {
    const currentId = nextMessageIdRef.current;
    nextMessageIdRef.current += 1;
    return currentId;
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

      const data: { message: string } = (await response.json()) as {
        message: string;
      };

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
        ok: true,
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
            works, and talking when a reply comes back.
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
          <div className={`status-pill status-pill--${companionState}`}>
            {companionState}
          </div>
        </div>

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
