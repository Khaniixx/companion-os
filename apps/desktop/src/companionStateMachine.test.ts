import { describe, expect, it } from "vitest";

import {
  getSettledCompanionState,
  transitionCompanionState,
} from "./companionStateMachine";

describe("companionStateMachine", () => {
  it("derives the settled state from focus and draft", () => {
    expect(
      getSettledCompanionState({ draft: "", focused: true }),
    ).toBe("idle");
    expect(
      getSettledCompanionState({ draft: "hello", focused: true }),
    ).toBe("listening");
    expect(
      getSettledCompanionState({ draft: "hello", focused: false }),
    ).toBe("idle");
  });

  it("moves into reaction for successful utility actions", () => {
    const transition = transitionCompanionState(
      { type: "utilityActionCompleted", action: "created_timer" },
      {
        draft: "",
        focused: true,
        isSending: false,
      },
    );

    expect(transition.state).toBe("reaction");
    expect(transition.durationMs).toBe(1350);
  });

  it("keeps runtime failures in the error state path", () => {
    const transition = transitionCompanionState(
      { type: "responseReceived", ok: false, messageLength: 42 },
      {
        draft: "",
        focused: true,
        isSending: false,
      },
    );

    expect(transition.state).toBe("error");
    expect(transition.durationMs).toBe(1700);
  });

  it("keeps longer replies in the talking state for longer", () => {
    const shortReply = transitionCompanionState(
      { type: "responseReceived", ok: true, messageLength: 24 },
      {
        draft: "",
        focused: true,
        isSending: false,
      },
    );
    const longReply = transitionCompanionState(
      { type: "responseReceived", ok: true, messageLength: 180 },
      {
        draft: "",
        focused: true,
        isSending: false,
      },
    );

    expect(shortReply.state).toBe("talking");
    expect(longReply.state).toBe("talking");
    expect(longReply.durationMs).toBeGreaterThan(shortReply.durationMs ?? 0);
  });
});
