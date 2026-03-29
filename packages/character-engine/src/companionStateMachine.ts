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
    }
  | {
      type: "windowFocusChanged";
      focused: boolean;
    }
  | {
      type: "utilityActionCompleted";
    }
  | {
      type: "settle";
    };

export type CompanionTransition = {
  state: CompanionState;
  durationMs: number | null;
};

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
        return { state: "talking", durationMs: 1400 };
      }

      return { state: "error", durationMs: 1800 };

    case "utilityActionCompleted":
      return { state: "reaction", durationMs: 1100 };

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
