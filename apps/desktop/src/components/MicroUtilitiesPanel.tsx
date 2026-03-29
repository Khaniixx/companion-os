import type { MicroUtilityState } from "../microUtilityApi";

type MicroUtilitiesPanelProps = {
  state: MicroUtilityState | null;
  isBusy: boolean;
  onSetTimer: () => void;
  onSaveClipboard: () => void;
  onShowTodos: () => void;
  onRunShortcut: (shortcutId: string) => void;
  onToggleNote: (noteId: number, completed: boolean) => void;
  onEditNote: (noteId: number, currentLabel: string) => void;
  onDismissAlert: (utilityId: number) => void;
};

function formatDueTime(isoValue: string | null): string {
  if (isoValue === null) {
    return "No due time";
  }

  const dueAt = new Date(isoValue);
  if (Number.isNaN(dueAt.getTime())) {
    return "Soon";
  }

  return dueAt.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function summarizeClipboard(text: string): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= 52) {
    return flattened;
  }

  return `${flattened.slice(0, 49).trimEnd()}...`;
}

export function MicroUtilitiesPanel({
  state,
  isBusy,
  onSetTimer,
  onSaveClipboard,
  onShowTodos,
  onRunShortcut,
  onToggleNote,
  onEditNote,
  onDismissAlert,
}: MicroUtilitiesPanelProps) {
  const activeTimers = state?.timers.slice(0, 2) ?? [];
  const activeReminders = state?.reminders.slice(0, 2) ?? [];
  const notes = state?.notes.slice(0, 4) ?? [];
  const alerts = state?.alerts.slice(0, 2) ?? [];
  const clipboardEntries = state?.clipboard_history.slice(0, 2) ?? [];
  const shortcuts = state?.shortcuts.slice(0, 3) ?? [];

  return (
    <section className="utility-panel" aria-label="Companion desk">
      <div className="utility-panel__header">
        <div>
          <span className="eyebrow">Desk</span>
          <h3>Quiet tools, kept close</h3>
        </div>
        <div className="utility-panel__counts" aria-label="Utility counts">
          <span>{state?.timers.length ?? 0} active</span>
          <span>{state?.notes.length ?? 0} notes</span>
          <span>{state?.clipboard_history.length ?? 0} clips</span>
        </div>
      </div>

      {alerts.length > 0 ? (
        <div className="utility-alerts" aria-live="polite">
          {alerts.map((item) => (
            <div className="utility-alert" key={`alert-${item.id}`}>
              <div>
                <span className="utility-alert__eyebrow">
                  {item.kind === "alarm" ? "Alarm complete" : "Timer complete"}
                </span>
                <strong>{item.label}</strong>
                <p>
                  {item.kind === "alarm"
                    ? "A saved alarm just finished."
                    : "Your timer just finished."}
                </p>
              </div>
              <button
                className="utility-alert__button"
                disabled={isBusy}
                type="button"
                onClick={() => {
                  onDismissAlert(item.id);
                }}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="utility-panel__actions">
        <button
          className="utility-action-button utility-action-button--primary"
          disabled={isBusy}
          type="button"
          onClick={onSetTimer}
        >
          Set 5 minute timer
        </button>
        <button
          className="utility-action-button"
          disabled={isBusy}
          type="button"
          onClick={onSaveClipboard}
        >
          Save clipboard
        </button>
        <button
          className="utility-action-button"
          disabled={isBusy}
          type="button"
          onClick={onShowTodos}
        >
          Show notes
        </button>
      </div>

      <div className="utility-panel__grid">
        <article className="utility-column">
          <h4>Next up</h4>
          {activeTimers.length === 0 && activeReminders.length === 0 ? (
            <p className="utility-column__empty">
              No active timers or reminders yet.
            </p>
          ) : (
            <div className="utility-list">
              {activeTimers.map((item) => (
                <div className="utility-list__item" key={`timer-${item.id}`}>
                  <span className="utility-list__label">{item.label}</span>
                  <span className="utility-list__meta">
                    {formatDueTime(item.due_at)}
                  </span>
                </div>
              ))}
              {activeReminders.map((item) => (
                <div className="utility-list__item" key={`reminder-${item.id}`}>
                  <span className="utility-list__label">{item.label}</span>
                  <span className="utility-list__meta">
                    {formatDueTime(item.due_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="utility-column">
          <h4>Notes</h4>
          {notes.length === 0 ? (
            <p className="utility-column__empty">
              Your local reminder list is clear.
            </p>
          ) : (
            <div className="utility-list">
              {notes.map((item) => (
                <div className="utility-list__item" key={`note-${item.id}`}>
                  <div className="utility-list__stack">
                    <span className="utility-list__label">{item.label}</span>
                    <span className="utility-list__meta">
                      {item.kind === "reminder"
                        ? `Reminder · ${formatDueTime(item.due_at)}`
                        : item.completed
                          ? "To-do · Done"
                          : "To-do · Open"}
                    </span>
                  </div>
                  <div className="utility-list__actions">
                    <button
                      className="utility-inline-button"
                      disabled={isBusy}
                      type="button"
                      onClick={() => {
                        onToggleNote(item.id, !item.completed);
                      }}
                    >
                      {item.completed ? "Reopen" : "Done"}
                    </button>
                    <button
                      className="utility-inline-button"
                      disabled={isBusy}
                      type="button"
                      onClick={() => {
                        onEditNote(item.id, item.label);
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="utility-column">
          <h4>Clipboard</h4>
          {clipboardEntries.length === 0 ? (
            <p className="utility-column__empty">
              Nothing saved from the clipboard yet.
            </p>
          ) : (
            <div className="utility-list">
              {clipboardEntries.map((entry) => (
                <div className="utility-list__item" key={`clip-${entry.id}`}>
                  <span className="utility-list__label">
                    {summarizeClipboard(entry.text)}
                  </span>
                  <span className="utility-list__meta">Saved locally</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="utility-column">
          <h4>Shortcuts</h4>
          {shortcuts.length === 0 ? (
            <p className="utility-column__empty">
              No quick-launch shortcuts are ready yet.
            </p>
          ) : (
            <div className="utility-shortcuts">
              {shortcuts.map((shortcut) => (
                <button
                  className="utility-shortcut-button"
                  disabled={isBusy}
                  key={shortcut.id}
                  type="button"
                  onClick={() => {
                    onRunShortcut(shortcut.id);
                  }}
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
