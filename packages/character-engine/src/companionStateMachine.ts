export type CompanionState =
  | "idle"
  | "listening"
  | "thinking"
  | "talking"
  | "reaction"
  | "error";

export type CompanionStateContext = {
  draft: string;
  focused: boolean;
  isSending: boolean;
};

export type CompanionStateEvent =
  | {
      type: "draftChanged";
      draft: string;
    }
  | {
      type: "userMessageSent";
    }
  | {
      type: "responseReceived";
      ok: boolean;
      messageLength: number;
    }
  | {
      type: "windowFocusChanged";
      focused: boolean;
    }
  | {
      type: "utilityActionCompleted";
      action: string;
    }
  | {
      type: "settle";
    };

export type CompanionTransition = {
  state: CompanionState;
  durationMs: number | null;
};

function getTalkingDurationMs(messageLength: number): number {
  const normalizedLength = Math.max(0, messageLength);
  return Math.min(2800, 1200 + Math.round(normalizedLength * 9));
}

function getReactionDurationMs(action: string): number {
  if (action === "created_timer" || action === "created_alarm") {
    return 1350;
  }

  if (action === "created_reminder" || action === "created_todo") {
    return 1200;
  }

  return 1000;
}

export function getSettledCompanionState(
  context: Pick<CompanionStateContext, "draft" | "focused">,
): CompanionState {
  if (!context.focused) {
    return "idle";
  }

  return context.draft.trim().length > 0 ? "listening" : "idle";
}

export function transitionCompanionState(
  event: CompanionStateEvent,
  context: CompanionStateContext,
): CompanionTransition {
  switch (event.type) {
    case "draftChanged":
      if (context.isSending) {
        return { state: "thinking", durationMs: null };
      }

      return {
        state: getSettledCompanionState({
          draft: event.draft,
          focused: context.focused,
        }),
        durationMs: null,
      };

    case "userMessageSent":
      return { state: "thinking", durationMs: null };

    case "responseReceived":
      if (event.ok) {
        return {
          state: "talking",
          durationMs: getTalkingDurationMs(event.messageLength),
        };
      }

      return { state: "error", durationMs: 1700 };

    case "utilityActionCompleted":
      return { state: "reaction", durationMs: getReactionDurationMs(event.action) };

    case "windowFocusChanged":
      if (context.isSending) {
        return { state: "thinking", durationMs: null };
      }

      return {
        state: getSettledCompanionState({
          draft: context.draft,
          focused: event.focused,
        }),
        durationMs: null,
      };

    case "settle":
      return {
        state: getSettledCompanionState({
          draft: context.draft,
          focused: context.focused,
        }),
        durationMs: null,
      };
  }
}
