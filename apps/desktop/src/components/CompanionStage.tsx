import type { CSSProperties } from "react";

import type { CompanionState } from "../companionStateMachine";
import type {
  PackAvatarConfig,
  PackModelConfig,
  PackVoiceConfig,
} from "../packApi";
import { getRendererRuntimeSupport } from "../rendererRuntime";
import type { SpeechInputSessionStatus } from "../speechInput";
import type { SpeechOutputStatus } from "../speechOutput";
import { CompanionAvatar } from "./CompanionAvatar";
import { Live2DPixiPreview } from "./Live2DPixiPreview";

type CompanionStageProps = {
  state: CompanionState;
  displayName?: string;
  packId?: string;
  avatarConfig?: PackAvatarConfig;
  modelConfig?: PackModelConfig;
  voiceConfig?: PackVoiceConfig;
  iconDataUrl?: string | null;
  previewImageUrl?: string | null;
  modelAssetUrl?: string | null;
  presenceAnchor?:
    | "desktop-right"
    | "desktop-left"
    | "active-window-right"
    | "active-window-left"
    | "active-window-top-right"
    | "active-window-top-left"
    | "workspace";
  presencePinned?: boolean;
  presenceTargetTitle?: string | null;
  speechInputStatus?: SpeechInputSessionStatus;
  speechInputLevel?: number;
  speechPlaybackStatus?: SpeechOutputStatus;
  speechPlaybackProgress?: number;
  speechPlaybackTextLength?: number;
};

function getAttachmentMode(
  presencePinned: boolean,
  presenceAnchor: CompanionStageProps["presenceAnchor"],
): "attached" | "docked" | "workspace" {
  if (!presencePinned || presenceAnchor === "workspace" || presenceAnchor === undefined) {
    return "workspace";
  }
  if (
    presenceAnchor === "active-window-left" ||
    presenceAnchor === "active-window-right" ||
    presenceAnchor === "active-window-top-left" ||
    presenceAnchor === "active-window-top-right"
  ) {
    return "attached";
  }
  return "docked";
}

function getAttachmentLabel(
  attachmentMode: "attached" | "docked" | "workspace",
  presenceAnchor: CompanionStageProps["presenceAnchor"],
  presenceTargetTitle: string | null | undefined,
): string {
  if (attachmentMode === "attached") {
    if (presenceTargetTitle) {
      return presenceAnchor === "active-window-top-left" ||
        presenceAnchor === "active-window-top-right"
        ? `Perched on ${presenceTargetTitle}`
        : `Following ${presenceTargetTitle}`;
    }
    return presenceAnchor === "active-window-left"
      ? "Attached left of active app"
      : presenceAnchor === "active-window-top-left"
        ? "Perched on top-left of active app"
        : presenceAnchor === "active-window-top-right"
          ? "Perched on top-right of active app"
          : "Attached right of active app";
  }
  if (attachmentMode === "docked") {
    return presenceAnchor === "desktop-left"
      ? "Docked to desktop left"
      : "Docked to desktop right";
  }
  return "Resting in workspace";
}

function getPresenceCue(state: CompanionState): string {
  if (state === "idle") {
    return "Quietly nearby";
  }
  if (state === "listening") {
    return "Leaning in";
  }
  if (state === "thinking") {
    return "Holding the thread";
  }
  if (state === "talking") {
    return "With you now";
  }
  if (state === "reaction") {
    return "Perking up";
  }
  return "Needs a breath";
}

function getLive2DHook(
  state: CompanionState,
  modelConfig?: PackModelConfig,
): string {
  if (state === "idle") {
    return modelConfig?.idle_hook ?? "idle-loop";
  }
  if (state === "talking") {
    return modelConfig?.speaking_hook ?? "speak-soft";
  }
  if (state === "reaction") {
    return modelConfig?.perched_hook ?? "perk-up";
  }
  return modelConfig?.attached_hook ?? "follow-thread";
}

function getBlinkHook(modelConfig?: PackModelConfig): string {
  return modelConfig?.blink_hook ?? "blink-soft";
}

function getLookAtHook(
  state: CompanionState,
  attachmentMode: "attached" | "docked" | "workspace",
  modelConfig?: PackModelConfig,
): string {
  if (state === "listening" || state === "talking" || attachmentMode === "attached") {
    return modelConfig?.look_at_hook ?? "look-at-cursor";
  }
  return modelConfig?.look_at_hook ?? "look-at-center";
}

function getIdleEyeHook(
  state: CompanionState,
  modelConfig?: PackModelConfig,
): string {
  return state === "idle" || state === "thinking"
    ? modelConfig?.idle_eye_hook ?? "idle-glance"
    : modelConfig?.idle_eye_hook ?? "steady-gaze";
}

function getLive2DStageBadge(
  modelConfig: PackModelConfig | undefined,
  runtimeAvailable: boolean,
): string {
  if (!runtimeAvailable) {
    return "Pixi fallback";
  }
  return modelConfig?.asset_path ? "Pixi Live2D ready" : "Pixi runtime ready";
}

function getVRMStageBadge(
  modelConfig: PackModelConfig | undefined,
  runtimeAvailable: boolean,
): string {
  if (!runtimeAvailable) {
    return "VRM staged";
  }
  return modelConfig?.asset_path ? "three-vrm ready" : "VRM runtime ready";
}

function getListeningIntensity(
  state: CompanionState,
  speechInputStatus: SpeechInputSessionStatus | undefined,
  speechInputLevel: number | undefined,
): number {
  if (
    state !== "listening" &&
    speechInputStatus !== "hearing" &&
    speechInputStatus !== "listening"
  ) {
    return 0;
  }

  if (speechInputStatus === "hearing") {
    return Number(Math.max(0.24, Math.min(speechInputLevel ?? 0, 1)).toFixed(2));
  }

  return Number(Math.max(0.12, Math.min((speechInputLevel ?? 0) * 0.8, 0.4)).toFixed(2));
}

function getSpeechPlaybackIntensity(
  state: CompanionState,
  speechPlaybackStatus: SpeechOutputStatus | undefined,
  speechPlaybackProgress: number | undefined,
  speechPlaybackTextLength: number | undefined,
): number {
  if (
    state !== "talking" ||
    (speechPlaybackStatus !== "speaking" && speechPlaybackStatus !== "starting")
  ) {
    return 0;
  }

  const boundedProgress = Math.max(0, Math.min(speechPlaybackProgress ?? 0, 1));
  const textLength = Math.max(speechPlaybackTextLength ?? 0, 1);
  const cadenceOffset = (textLength % 7) / 7;
  const wave = Math.abs(Math.sin((boundedProgress + cadenceOffset) * Math.PI * 4));
  const baseIntensity = speechPlaybackStatus === "starting" ? 0.38 : 0.56;
  return Number(Math.min(1, baseIntensity + wave * 0.36).toFixed(2));
}

function renderLive2DStage({
  state,
  displayName = "Aster",
  packId,
  avatarConfig,
  modelConfig,
  iconDataUrl,
  previewImageUrl,
  modelAssetUrl,
  presenceAnchor = "workspace",
  presencePinned = false,
  presenceTargetTitle,
  speechInputStatus = "idle",
  speechInputLevel = 0,
  speechPlaybackStatus = "idle",
  speechPlaybackProgress = 0,
  speechPlaybackTextLength = 0,
}: CompanionStageProps) {
  const runtimeSupport = getRendererRuntimeSupport();
  const attachmentMode = getAttachmentMode(presencePinned, presenceAnchor);
  const attachmentLabel = getAttachmentLabel(
    attachmentMode,
    presenceAnchor,
    presenceTargetTitle,
  );
  const presenceCue = getPresenceCue(state);
  const live2dHook = getLive2DHook(state, modelConfig);
  const blinkHook = getBlinkHook(modelConfig);
  const lookAtHook = getLookAtHook(state, attachmentMode, modelConfig);
  const idleEyeHook = getIdleEyeHook(state, modelConfig);
  const stageLabel = avatarConfig?.stage_label ?? "Live2D stage";
  const badgeLabel = getLive2DStageBadge(
    modelConfig,
    runtimeSupport.live2d.available,
  );
  const listeningIntensity = getListeningIntensity(
    state,
    speechInputStatus,
    speechInputLevel,
  );
  const speechPlaybackIntensity = getSpeechPlaybackIntensity(
    state,
    speechPlaybackStatus,
    speechPlaybackProgress,
    speechPlaybackTextLength,
  );
  const speechPlaybackActive =
    speechPlaybackStatus === "speaking" || speechPlaybackStatus === "starting";
  const live2dStyle = {
    "--avatar-accent": avatarConfig?.accent_color ?? "#9db9ff",
    "--avatar-aura": avatarConfig?.aura_color ?? "#87ead8",
    "--live2d-mouth-open": `${14 + Math.round(speechPlaybackIntensity * 14)}px`,
    "--live2d-mouth-width": `${44 + Math.round(speechPlaybackIntensity * 12)}px`,
    "--live2d-eye-shift": `${Math.round(speechPlaybackIntensity * 6)}px`,
    "--live2d-listen-intensity": listeningIntensity.toFixed(2),
  } as CSSProperties;

  return (
    <div
      className={`live2d-stage live2d-stage--${state} live2d-stage--${attachmentMode}${speechPlaybackActive ? " live2d-stage--speech-active" : ""}`}
      aria-live="polite"
      aria-label={`${displayName} avatar is ${state}`}
      data-stage-renderer="live2d"
      data-stage-runtime={runtimeSupport.live2d.available ? "pixi" : "fallback"}
      data-pack-id={packId ?? "none"}
      data-live2d-hook={live2dHook}
      data-model-asset={modelConfig?.asset_path ?? "missing"}
      data-model-asset-url={modelAssetUrl ?? "missing"}
      data-attachment-mode={attachmentMode}
      data-attachment-label={attachmentLabel}
      data-stage-label={stageLabel}
      data-blink-hook={blinkHook}
      data-look-at-hook={lookAtHook}
      data-idle-eye-hook={idleEyeHook}
      data-speech-input-status={speechInputStatus}
      data-speech-input-level={speechInputLevel.toFixed(2)}
      data-listening-intensity={listeningIntensity.toFixed(2)}
      data-speech-playback-status={speechPlaybackStatus}
      data-speech-playback-progress={speechPlaybackProgress.toFixed(2)}
      data-speech-intensity={speechPlaybackIntensity.toFixed(2)}
      style={live2dStyle}
    >
      <div className="avatar-plaque" aria-hidden="true">
        <span className="avatar-plaque__label">{stageLabel}</span>
        <span className="avatar-plaque__badge avatar-plaque__badge--model">
          {badgeLabel}
        </span>
      </div>
      <div className="avatar-dock" aria-hidden="true">
        <span className={`avatar-dock__chip avatar-dock__chip--${attachmentMode}`}>
          {attachmentLabel}
        </span>
        <span className={`avatar-dock__rail avatar-dock__rail--${attachmentMode}`} />
      </div>
      <div className="live2d-stage__frame" aria-hidden="true">
        <div className="live2d-stage__sheet" />
        <div className="live2d-stage__spotlight" />
        <div className={`live2d-stage__focus live2d-stage__focus--${state}`} />
        <div className="live2d-stage__portrait">
          <Live2DPixiPreview
            packId={packId}
            modelUrl={modelAssetUrl}
            imageUrl={previewImageUrl ?? iconDataUrl}
            accentColor={avatarConfig?.accent_color}
            auraColor={avatarConfig?.aura_color}
            listeningIntensity={listeningIntensity}
            speechIntensity={speechPlaybackIntensity}
            displayName={displayName}
          />
          <div className="live2d-stage__face-overlay">
            <span className={`live2d-stage__eye live2d-stage__eye--left live2d-stage__eye--${state}`} />
            <span className={`live2d-stage__eye live2d-stage__eye--right live2d-stage__eye--${state}`} />
            <span className={`live2d-stage__mouth live2d-stage__mouth--${state}`} />
          </div>
        </div>
        <div className="live2d-stage__scanline live2d-stage__scanline--top" />
        <div className="live2d-stage__scanline live2d-stage__scanline--bottom" />
      </div>
      <div className={`live2d-stage__status live2d-stage__status--${state}`}>
        <span className="live2d-stage__status-label">Live2D hooks</span>
        <strong>{live2dHook}</strong>
        <span>{blinkHook}</span>
        <span>{lookAtHook}</span>
        <span>{idleEyeHook}</span>
        <span>
          {speechInputStatus === "hearing"
            ? `listen-follow ${listeningIntensity.toFixed(2)}`
            : speechInputStatus === "listening"
              ? `listen-ready ${listeningIntensity.toFixed(2)}`
              : "listen-idle"}
        </span>
        <span>
          {speechPlaybackActive
            ? `speech-follow ${speechPlaybackIntensity.toFixed(2)}`
            : "speech-idle"}
        </span>
      </div>
      <span className="avatar-screen-reader">
        {displayName} is on the Live2D stage with the {live2dHook} hook active.
        {` ${blinkHook}. ${lookAtHook}. ${idleEyeHook}. Listening intensity ${listeningIntensity.toFixed(2)}. Speech intensity ${speechPlaybackIntensity.toFixed(2)}. ${attachmentLabel}. ${presenceCue}.`}
      </span>
    </div>
  );
}

function renderVRMStage({
  state,
  displayName = "Aster",
  packId,
  avatarConfig,
  modelConfig,
  iconDataUrl,
  previewImageUrl,
  presenceAnchor = "workspace",
  presencePinned = false,
  presenceTargetTitle,
}: CompanionStageProps) {
  const runtimeSupport = getRendererRuntimeSupport();
  const attachmentMode = getAttachmentMode(presencePinned, presenceAnchor);
  const attachmentLabel = getAttachmentLabel(
    attachmentMode,
    presenceAnchor,
    presenceTargetTitle,
  );
  const presenceCue = getPresenceCue(state);
  const stageLabel = avatarConfig?.stage_label ?? "VRM stage";
  const badgeLabel = getVRMStageBadge(modelConfig, runtimeSupport.vrm.available);
  const expressionHook =
    state === "talking"
      ? modelConfig?.speaking_hook ?? "speak-soft"
      : state === "listening"
        ? modelConfig?.look_at_hook ?? "attend"
        : state === "reaction"
          ? modelConfig?.perched_hook ?? "perk-up"
          : modelConfig?.idle_hook ?? "idle";

  return (
    <div
      className={`live2d-stage live2d-stage--${state} live2d-stage--${attachmentMode} live2d-stage--vrm`}
      aria-live="polite"
      aria-label={`${displayName} avatar is ${state}`}
      data-stage-renderer="vrm"
      data-stage-runtime={runtimeSupport.vrm.available ? "three-vrm" : "fallback"}
      data-pack-id={packId ?? "none"}
      data-model-asset={modelConfig?.asset_path ?? "missing"}
      data-attachment-mode={attachmentMode}
      data-attachment-label={attachmentLabel}
      data-vrm-expression={expressionHook}
    >
      <div className="avatar-plaque" aria-hidden="true">
        <span className="avatar-plaque__label">{stageLabel}</span>
        <span className="avatar-plaque__badge avatar-plaque__badge--model">
          {badgeLabel}
        </span>
      </div>
      <div className="avatar-dock" aria-hidden="true">
        <span className={`avatar-dock__chip avatar-dock__chip--${attachmentMode}`}>
          {attachmentLabel}
        </span>
        <span className={`avatar-dock__rail avatar-dock__rail--${attachmentMode}`} />
      </div>
      <div className="live2d-stage__frame" aria-hidden="true">
        <div className="live2d-stage__sheet" />
        <div className="live2d-stage__spotlight" />
        <div className="live2d-stage__portrait live2d-stage__portrait--vrm">
          {previewImageUrl || iconDataUrl ? (
            <img
              alt=""
              className="live2d-stage__image"
              src={previewImageUrl ?? iconDataUrl ?? undefined}
            />
          ) : (
            <span className="live2d-stage__fallback">
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="live2d-stage__vrm-ring" />
        </div>
      </div>
      <div className={`live2d-stage__status live2d-stage__status--${state}`}>
        <span className="live2d-stage__status-label">VRM path</span>
        <strong>{expressionHook}</strong>
        <span>{runtimeSupport.vrm.available ? "three-vrm runtime" : "runtime fallback"}</span>
        <span>{presenceCue}</span>
      </div>
      <span className="avatar-screen-reader">
        {displayName} is on the VRM stage with the {expressionHook} expression hook active.
        {` ${attachmentLabel}. ${presenceCue}.`}
      </span>
    </div>
  );
}

export function CompanionStage(props: CompanionStageProps) {
  if (
    props.modelConfig?.renderer === "live2d" &&
    typeof props.modelConfig.asset_path === "string" &&
    props.modelConfig.asset_path.trim().length > 0
  ) {
    return renderLive2DStage(props);
  }

  if (
    props.modelConfig?.renderer === "vrm" &&
    typeof props.modelConfig.asset_path === "string" &&
    props.modelConfig.asset_path.trim().length > 0
  ) {
    return renderVRMStage(props);
  }

  return (
    <CompanionAvatar
      state={props.state}
      displayName={props.displayName}
      avatarConfig={props.avatarConfig}
      modelConfig={props.modelConfig}
      voiceConfig={props.voiceConfig}
      iconDataUrl={props.iconDataUrl}
      presenceAnchor={props.presenceAnchor}
      presencePinned={props.presencePinned}
      presenceTargetTitle={props.presenceTargetTitle}
    />
  );
}
