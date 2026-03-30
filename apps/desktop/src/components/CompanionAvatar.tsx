import type { CSSProperties } from "react";

import type { CompanionState } from "../companionStateMachine";
import type { PackAvatarConfig, PackVoiceConfig } from "../packApi";

type CompanionAvatarProps = {
  state: CompanionState;
  displayName?: string;
  avatarConfig?: PackAvatarConfig;
  voiceConfig?: PackVoiceConfig;
  iconDataUrl?: string | null;
};

type AvatarPresentationMode = "shell" | "portrait" | "model";

function getAnimationName(
  state: CompanionState,
  avatarConfig?: PackAvatarConfig,
): string {
  if (state === "idle") {
    return avatarConfig?.idle_animation ?? "idle";
  }
  if (state === "listening") {
    return avatarConfig?.listening_animation ?? "listening";
  }
  if (state === "thinking") {
    return avatarConfig?.thinking_animation ?? "thinking";
  }
  if (state === "talking") {
    return avatarConfig?.talking_animation ?? "talking";
  }
  if (state === "reaction") {
    return avatarConfig?.reaction_animation ?? "reaction";
  }
  return "error";
}

function getVoiceCue(
  state: CompanionState,
  avatarConfig?: PackAvatarConfig,
  voiceConfig?: PackVoiceConfig,
): string {
  const audioCue = avatarConfig?.audio_cues?.[state];
  if (audioCue) {
    return audioCue;
  }

  const voiceId = voiceConfig?.voice_id ?? "default";
  return state === "idle" ? `${voiceId}-idle-loop` : `${voiceId}-${state}`;
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

function getAvatarMode(avatarConfig?: PackAvatarConfig): AvatarPresentationMode {
  if (avatarConfig?.presentation_mode === "portrait") {
    return "portrait";
  }
  if (
    avatarConfig?.presentation_mode === "model" ||
    (avatarConfig?.model_path ?? null) !== null
  ) {
    return "model";
  }
  return "shell";
}

function getAvatarStageLabel(
  mode: AvatarPresentationMode,
  avatarConfig: PackAvatarConfig | undefined,
): string {
  if (avatarConfig?.stage_label) {
    return avatarConfig.stage_label;
  }
  if (mode === "model") {
    return "Model-ready shell";
  }
  if (mode === "portrait") {
    return "Portrait-led shell";
  }
  return "Desk shell";
}

function getAvatarBadge(mode: AvatarPresentationMode): string {
  if (mode === "model") {
    return "Model-ready";
  }
  if (mode === "portrait") {
    return "Portrait-led";
  }
  return "Shell";
}

function getAvatarReadiness(
  mode: AvatarPresentationMode,
  iconDataUrl: string | null | undefined,
): string {
  if (mode === "model") {
    return "Pack has a model path ready for richer rendering.";
  }
  if (iconDataUrl) {
    return "Pack icon is driving this shell presentation.";
  }
  return "Fallback shell is carrying the active companion identity.";
}

export function CompanionAvatar({
  state,
  displayName = "Aster",
  avatarConfig,
  voiceConfig,
  iconDataUrl,
}: CompanionAvatarProps) {
  const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
  const animationName = getAnimationName(state, avatarConfig);
  const voiceCue = getVoiceCue(state, avatarConfig, voiceConfig);
  const presenceCue = getPresenceCue(state);
  const avatarMode = getAvatarMode(avatarConfig);
  const stageLabel = getAvatarStageLabel(avatarMode, avatarConfig);
  const stageBadge = getAvatarBadge(avatarMode);
  const readinessLabel = getAvatarReadiness(avatarMode, iconDataUrl);
  const avatarStyle = {
    "--avatar-accent": avatarConfig?.accent_color ?? "#9db9ff",
    "--avatar-aura": avatarConfig?.aura_color ?? "#87ead8",
  } as CSSProperties;

  return (
    <div
      className={`avatar-shell avatar-shell--${state} avatar-shell--${avatarMode}`}
      aria-live="polite"
      aria-label={`${displayName} avatar is ${state}`}
      data-animation={animationName}
      data-avatar-mode={avatarMode}
      data-idle-loop={state === "idle" ? "true" : "false"}
      data-presence-cue={presenceCue}
      data-stage-label={stageLabel}
      data-voice-clip={voiceCue}
      style={avatarStyle}
    >
      <div className="avatar-plaque" aria-hidden="true">
        <span className="avatar-plaque__label">{stageLabel}</span>
        <span className={`avatar-plaque__badge avatar-plaque__badge--${avatarMode}`}>
          {stageBadge}
        </span>
      </div>
      <div className="avatar-aura" />
      <div className="avatar-ears" aria-hidden="true">
        <span className={`avatar-ear avatar-ear--left avatar-ear--${state}`} />
        <span className={`avatar-ear avatar-ear--right avatar-ear--${state}`} />
      </div>
      <div className="avatar-body">
        <div className={`avatar-tail avatar-tail--${state}`} aria-hidden="true" />
        <div className="avatar-medallion" aria-hidden="true">
          {iconDataUrl ? (
            <img
              alt=""
              className="avatar-medallion__image"
              src={iconDataUrl}
            />
          ) : (
            <span className="avatar-medallion__fallback">
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        {avatarMode === "model" ? (
          <div className="avatar-model-ring" aria-hidden="true">
            model path ready
          </div>
        ) : null}
        <div className="avatar-face">
          <span className={`avatar-eye avatar-eye--${state}`} />
          <span className={`avatar-eye avatar-eye--${state}`} />
          <span className={`avatar-mouth avatar-mouth--${state}`} />
        </div>
      </div>
      <div className={`avatar-whisper avatar-whisper--${state}`} aria-hidden="true">
        {presenceCue}
      </div>
      <span className="avatar-screen-reader">
        {displayName} is using the {animationName} animation with the {voiceCue} cue.
        {` ${stageLabel}. ${readinessLabel} ${displayName} feels ${presenceCue.toLowerCase()}.`}
      </span>
      <div className="avatar-status">
        <span className="avatar-status__label">State</span>
        <strong>{stateLabel}</strong>
      </div>
    </div>
  );
}
