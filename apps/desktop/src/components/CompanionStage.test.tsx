import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompanionStage } from "./CompanionStage";

describe("CompanionStage", () => {
  it("uses the Live2D adapter when the pack manifest provides a Live2D asset", () => {
    render(
      <CompanionStage
        state="idle"
        displayName="Sunrise"
        packId="sunrise-companion"
        iconDataUrl="data:image/png;base64,AAAA"
        previewImageUrl="http://127.0.0.1:8000/api/packs/sunrise-companion/preview-image"
        modelAssetUrl="http://127.0.0.1:8000/api/packs/sunrise-companion/model-asset"
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
          blink_hook: "blink-soft",
          look_at_hook: "look-at-cursor",
          idle_eye_hook: "idle-glance",
        }}
      />,
    );

    const stage = screen.getByLabelText("Sunrise avatar is idle");
    expect(stage).toHaveAttribute("data-stage-renderer", "live2d");
    expect(stage).toHaveAttribute("data-pack-id", "sunrise-companion");
    expect(stage).toHaveAttribute("data-model-asset", "models/sunrise.model3.json");
    expect(stage).toHaveAttribute(
      "data-model-asset-url",
      "http://127.0.0.1:8000/api/packs/sunrise-companion/model-asset",
    );
    expect(stage).toHaveAttribute("data-live2d-hook", "idle-loop");
    expect(stage).toHaveAttribute("data-blink-hook", "blink-soft");
    expect(stage).toHaveAttribute("data-look-at-hook", "look-at-cursor");
    expect(stage).toHaveAttribute("data-idle-eye-hook", "idle-glance");
    expect(screen.getByText("Live2D loaded")).toBeInTheDocument();
    expect(screen.getByText("idle-loop")).toBeInTheDocument();
    expect(screen.getByText("blink-soft")).toBeInTheDocument();
    expect(screen.getByText("look-at-cursor")).toBeInTheDocument();
    expect(screen.getByText("idle-glance")).toBeInTheDocument();
    const previewImage = document.querySelector<HTMLImageElement>(".live2d-stage__image");
    expect(previewImage).not.toBeNull();
    expect(previewImage).toHaveAttribute(
      "src",
      "http://127.0.0.1:8000/api/packs/sunrise-companion/preview-image",
    );
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
          blink_hook: "blink-soft",
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

  it("keeps motion hooks visible while the Live2D stage is speaking", () => {
    render(
      <CompanionStage
        state="talking"
        displayName="Sunrise"
        avatarConfig={{
          presentation_mode: "portrait",
          stage_label: "Pack portrait",
        }}
        modelConfig={{
          renderer: "live2d",
          asset_path: "models/sunrise.model3.json",
          speaking_hook: "speak-soft",
          blink_hook: "blink-soft",
          look_at_hook: "look-at-cursor",
          idle_eye_hook: "idle-glance",
        }}
        speechPlaybackStatus="speaking"
        speechPlaybackProgress={0.42}
        speechPlaybackTextLength={96}
        presenceAnchor="active-window-right"
        presencePinned
        presenceTargetTitle="Visual Studio Code"
      />,
    );

    const stage = screen.getByLabelText("Sunrise avatar is talking");
    expect(stage).toHaveAttribute("data-stage-renderer", "live2d");
    expect(stage).toHaveAttribute("data-live2d-hook", "speak-soft");
    expect(stage).toHaveAttribute("data-look-at-hook", "look-at-cursor");
    expect(stage).toHaveAttribute("data-speech-playback-status", "speaking");
    expect(stage).toHaveAttribute("data-speech-playback-progress", "0.42");
    expect(stage).toHaveAttribute("data-speech-intensity", "0.92");
    expect(screen.getByText("Following Visual Studio Code")).toBeInTheDocument();
    expect(screen.getByText("speak-soft")).toBeInTheDocument();
    expect(screen.getByText("speech-follow 0.92")).toBeInTheDocument();
  });

  it("surfaces listening intensity while the Live2D stage is hearing mic activity", () => {
    render(
      <CompanionStage
        state="listening"
        displayName="Sunrise"
        avatarConfig={{
          presentation_mode: "portrait",
          stage_label: "Pack portrait",
        }}
        modelConfig={{
          renderer: "live2d",
          asset_path: "models/sunrise.model3.json",
          idle_hook: "idle-loop",
          attached_hook: "dock-right",
          blink_hook: "blink-soft",
          look_at_hook: "look-at-cursor",
          idle_eye_hook: "idle-glance",
        }}
        speechInputStatus="hearing"
        speechInputLevel={0.44}
      />,
    );

    const stage = screen.getByLabelText("Sunrise avatar is listening");
    expect(stage).toHaveAttribute("data-speech-input-status", "hearing");
    expect(stage).toHaveAttribute("data-speech-input-level", "0.44");
    expect(stage).toHaveAttribute("data-listening-intensity", "0.44");
    expect(screen.getByText("listen-follow 0.44")).toBeInTheDocument();
  });
});
