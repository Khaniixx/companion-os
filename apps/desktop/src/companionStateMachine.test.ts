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
      { type: "utilityActionCompleted" },
      {
        draft: "",
        focused: true,
        isSending: false,
      },
    );

    expect(transition.state).toBe("reaction");
    expect(transition.durationMs).toBe(1100);
  });

  it("keeps runtime failures in the error state path", () => {
    const transition = transitionCompanionState(
      { type: "responseReceived", ok: false },
      {
        draft: "",
        focused: true,
        isSending: false,
      },
    );

    expect(transition.state).toBe("error");
    expect(transition.durationMs).toBe(1800);
  });
});
