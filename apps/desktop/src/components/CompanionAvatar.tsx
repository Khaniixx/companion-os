import type { CompanionState } from "../companionStateMachine";
import type { PackAvatarConfig, PackVoiceConfig } from "../packApi";

type CompanionAvatarProps = {
  state: CompanionState;
  displayName?: string;
  avatarConfig?: PackAvatarConfig;
  voiceConfig?: PackVoiceConfig;
};

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

export function CompanionAvatar({
  state,
  displayName = "Companion",
  avatarConfig,
  voiceConfig,
}: CompanionAvatarProps) {
  const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
  const animationName = getAnimationName(state, avatarConfig);
  const voiceCue = getVoiceCue(state, avatarConfig, voiceConfig);

  return (
    <div
      className={`avatar-shell avatar-shell--${state}`}
      aria-live="polite"
      aria-label={`${displayName} avatar is ${state}`}
      data-animation={animationName}
      data-idle-loop={state === "idle" ? "true" : "false"}
      data-voice-clip={voiceCue}
    >
      <div className="avatar-aura" />
      <div className="avatar-ears" aria-hidden="true">
        <span className={`avatar-ear avatar-ear--left avatar-ear--${state}`} />
        <span className={`avatar-ear avatar-ear--right avatar-ear--${state}`} />
      </div>
      <div className="avatar-body">
        <div className={`avatar-tail avatar-tail--${state}`} aria-hidden="true" />
        <div className="avatar-face">
          <span className={`avatar-eye avatar-eye--${state}`} />
          <span className={`avatar-eye avatar-eye--${state}`} />
          <span className={`avatar-mouth avatar-mouth--${state}`} />
        </div>
      </div>
      <span className="avatar-screen-reader">
        {displayName} is using the {animationName} animation with the {voiceCue} cue.
      </span>
      <div className="avatar-status">
        <span className="avatar-status__label">State</span>
        <strong>{stateLabel}</strong>
      </div>
    </div>
  );
}
