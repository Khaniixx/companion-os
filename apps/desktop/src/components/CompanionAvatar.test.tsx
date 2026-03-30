import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompanionAvatar } from "./CompanionAvatar";

describe("CompanionAvatar", () => {
  it("loops the idle presentation with pack-specific animation metadata", () => {
    render(
      <CompanionAvatar
        state="idle"
        displayName="Sunrise"
        iconDataUrl="data:image/png;base64,AAAA"
        avatarConfig={{
          presentation_mode: "portrait",
          stage_label: "Pack portrait",
          accent_color: "#8FAEFF",
          aura_color: "#8CE6D8",
          idle_animation: "sunrise-idle",
        }}
        voiceConfig={{
          voice_id: "sunrise",
        }}
      />,
    );

    const avatar = screen.getByLabelText("Sunrise avatar is idle");
    expect(avatar).toHaveAttribute("data-animation", "sunrise-idle");
    expect(avatar).toHaveAttribute("data-avatar-mode", "portrait");
    expect(avatar).toHaveAttribute("data-idle-loop", "true");
    expect(avatar).toHaveAttribute("data-presence-cue", "Quietly nearby");
    expect(avatar).toHaveAttribute("data-stage-label", "Pack portrait");
    expect(avatar).toHaveAttribute("data-voice-clip", "sunrise-idle-loop");
    expect(screen.getByText(/sunrise-idle animation/i)).toBeInTheDocument();
    expect(screen.getByText("Quietly nearby")).toBeInTheDocument();
    expect(screen.getByText("Pack portrait")).toBeInTheDocument();
    expect(screen.getByText("Portrait-led")).toBeInTheDocument();
    expect(avatar).toHaveAttribute("data-attachment-mode", "workspace");
    expect(screen.getByText("Resting in workspace")).toBeInTheDocument();
  });

  it("marks model-ready packs distinctly while keeping the same state flow", () => {
    render(
      <CompanionAvatar
        state="talking"
        displayName="Bloom"
        avatarConfig={{
          presentation_mode: "model",
          stage_label: "Model shell",
          model_path: "models/bloom.glb",
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
    expect(avatar).toHaveAttribute("data-avatar-mode", "model");
    expect(avatar).toHaveAttribute("data-idle-loop", "false");
    expect(avatar).toHaveAttribute("data-presence-cue", "With you now");
    expect(avatar).toHaveAttribute("data-voice-clip", "voice/bloom-talk.ogg");
    expect(screen.getByText(/bloom-speak animation/i)).toBeInTheDocument();
    expect(screen.getByText("With you now")).toBeInTheDocument();
    expect(screen.getByText("Model shell")).toBeInTheDocument();
    expect(screen.getByText("Model-ready")).toBeInTheDocument();
    expect(screen.getByText("model path ready")).toBeInTheDocument();
  });

  it("shows attached presence cues when pinned beside the active app", () => {
    render(
      <CompanionAvatar
        state="listening"
        displayName="Bloom"
        presenceAnchor="active-window-right"
        presencePinned
        avatarConfig={{
          presentation_mode: "portrait",
          stage_label: "Window shell",
        }}
      />,
    );

    const avatar = screen.getByLabelText("Bloom avatar is listening");
    expect(avatar).toHaveAttribute("data-attachment-mode", "attached");
    expect(avatar).toHaveAttribute(
      "data-attachment-label",
      "Attached right of active app",
    );
    expect(screen.getByText("Attached right of active app")).toBeInTheDocument();
    expect(
      screen.getByText(/keeping close to the active window/i),
    ).toBeInTheDocument();
  });
});
