import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompanionAvatar } from "./CompanionAvatar";

describe("CompanionAvatar", () => {
  it("loops the idle presentation with pack-specific animation metadata", () => {
    render(
      <CompanionAvatar
        state="idle"
        displayName="Sunrise"
        avatarConfig={{
          idle_animation: "sunrise-idle",
        }}
        voiceConfig={{
          voice_id: "sunrise",
        }}
      />,
    );

    const avatar = screen.getByLabelText("Sunrise avatar is idle");
    expect(avatar).toHaveAttribute("data-animation", "sunrise-idle");
    expect(avatar).toHaveAttribute("data-idle-loop", "true");
    expect(avatar).toHaveAttribute("data-voice-clip", "sunrise-idle-loop");
    expect(screen.getByText(/sunrise-idle animation/i)).toBeInTheDocument();
  });

  it("exposes the correct talking animation and voice cue", () => {
    render(
      <CompanionAvatar
        state="talking"
        displayName="Bloom"
        avatarConfig={{
          talking_animation: "bloom-speak",
          audio_cues: {
            talking: "voice/bloom-talk.ogg",
          },
        }}
        voiceConfig={{
          voice_id: "bloom",
        }}
      />,
    );

    const avatar = screen.getByLabelText("Bloom avatar is talking");
    expect(avatar).toHaveAttribute("data-animation", "bloom-speak");
    expect(avatar).toHaveAttribute("data-idle-loop", "false");
    expect(avatar).toHaveAttribute("data-voice-clip", "voice/bloom-talk.ogg");
    expect(screen.getByText(/bloom-speak animation/i)).toBeInTheDocument();
  });
});
