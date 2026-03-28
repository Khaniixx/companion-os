import type { CompanionState } from "./components/CompanionAvatar";

export type CompanionMessage = {
  id: number;
  sender: "companion" | "user";
  text: string;
};

type StoredCompanionSession = {
  messages: CompanionMessage[];
  companionState: CompanionState;
};

const STORAGE_KEY = "companion-os.session";
const MAX_MESSAGES = 24;

function isCompanionState(value: string): value is CompanionState {
  return ["idle", "listening", "thinking", "talking", "error"].includes(value);
}

export function loadCompanionSession(
  fallbackMessages: CompanionMessage[],
): StoredCompanionSession {
  if (typeof window === "undefined") {
    return {
      messages: fallbackMessages,
      companionState: "idle",
    };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      messages: fallbackMessages,
      companionState: "idle",
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredCompanionSession>;
    const storedMessages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter(
            (message): message is CompanionMessage =>
              typeof message === "object" &&
              message !== null &&
              typeof message.id === "number" &&
              (message.sender === "companion" || message.sender === "user") &&
              typeof message.text === "string",
          )
          .slice(-MAX_MESSAGES)
      : fallbackMessages;

    const storedState =
      typeof parsed.companionState === "string" &&
      isCompanionState(parsed.companionState)
        ? parsed.companionState
        : "idle";

    return {
      messages: storedMessages.length > 0 ? storedMessages : fallbackMessages,
      companionState: storedState,
    };
  } catch {
    return {
      messages: fallbackMessages,
      companionState: "idle",
    };
  }
}

export function persistCompanionSession(
  messages: CompanionMessage[],
  companionState: CompanionState,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const payload: StoredCompanionSession = {
    messages: messages.slice(-MAX_MESSAGES),
    companionState,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearCompanionSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
