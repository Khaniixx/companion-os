import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompanionStage } from "./CompanionStage";

describe("CompanionStage", () => {
  it("uses the Live2D adapter when the pack manifest provides a Live2D asset", () => {
    render(
      <CompanionStage
        state="idle"
        displayName="Sunrise"
        iconDataUrl="data:image/png;base64,AAAA"
        avatarConfig={{
          presentation_mode: "portrait",
          stage_label: "Pack portrait",
          accent_color: "#8FAEFF",
          aura_color: "#8CE6D8",
        }}
        modelConfig={{
          renderer: "live2d",
          asset_path: "models/sunrise.model3.json",
          preview_image_path: "models/sunrise.png",
          idle_hook: "idle-loop",
          attached_hook: "dock-right",
          perched_hook: "perch-top",
          speaking_hook: "speak-soft",
        }}
      />,
    );

    const stage = screen.getByLabelText("Sunrise avatar is idle");
    expect(stage).toHaveAttribute("data-stage-renderer", "live2d");
    expect(stage).toHaveAttribute("data-model-asset", "models/sunrise.model3.json");
    expect(stage).toHaveAttribute("data-live2d-hook", "idle-loop");
    expect(screen.getByText("Live2D loaded")).toBeInTheDocument();
    expect(screen.getByText("idle-loop")).toBeInTheDocument();
  });

  it("falls back to the shell avatar when the Live2D asset is missing", () => {
    render(
      <CompanionStage
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
        modelConfig={{
          renderer: "live2d",
          idle_hook: "idle-loop",
        }}
        voiceConfig={{
          voice_id: "sunrise",
        }}
      />,
    );

    const avatar = screen.getByLabelText("Sunrise avatar is idle");
    expect(avatar).toHaveAttribute("data-avatar-mode", "portrait");
    expect(avatar).toHaveAttribute("data-model-renderer", "live2d");
    expect(avatar).not.toHaveAttribute("data-stage-renderer");
    expect(screen.getByText(/sunrise-idle animation/i)).toBeInTheDocument();
  });
});
