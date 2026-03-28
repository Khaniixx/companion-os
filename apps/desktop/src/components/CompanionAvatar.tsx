export type CompanionState =
  | "idle"
  | "listening"
  | "thinking"
  | "talking"
  | "error";

type CompanionAvatarProps = {
  state: CompanionState;
};

export function CompanionAvatar({ state }: CompanionAvatarProps) {
  const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);

  return (
    <div
      className={`avatar-shell avatar-shell--${state}`}
      aria-live="polite"
      aria-label={`Companion avatar is ${state}`}
    >
      <div className="avatar-aura" />
      <div className="avatar-body">
        <div className="avatar-face">
          <span className={`avatar-eye avatar-eye--${state}`} />
          <span className={`avatar-eye avatar-eye--${state}`} />
          <span className={`avatar-mouth avatar-mouth--${state}`} />
        </div>
      </div>
      <div className="avatar-status">
        <span className="avatar-status__label">State</span>
        <strong>{stateLabel}</strong>
      </div>
    </div>
  );
}
