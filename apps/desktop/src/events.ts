/**
 * Frontend event contract for the desktop companion shell.
 *
 * `draftChanged`
 * Fired whenever the local chat draft changes.
 *
 * `userMessageSent`
 * Fired when the user submits a chat message to the runtime.
 *
 * `responseReceived`
 * Fired when the frontend receives a reply to display in the transcript,
 * including fallback error text rendered as a companion message that can
 * drive the companion into its `error` state.
 *
 * `utilityActionCompleted`
 * Fired when a timer, reminder, to-do, clipboard save, or shortcut completes
 * and the companion should briefly react without interrupting the chat flow.
 *
 * `windowFocusChanged`
 * Fired when the desktop window gains or loses focus.
 */
export type CompanionEventMap = {
  draftChanged: {
    draft: string;
  };
  userMessageSent: {
    message: string;
  };
  responseReceived: {
    message: string;
    ok: boolean;
    messageLength: number;
  };
  utilityActionCompleted: {
    action: string;
  };
  windowFocusChanged: {
    focused: boolean;
  };
};

export type CompanionEventType = keyof CompanionEventMap;

export type CompanionEvent<K extends CompanionEventType = CompanionEventType> = {
  type: K;
  payload: CompanionEventMap[K];
  timestamp: number;
};
