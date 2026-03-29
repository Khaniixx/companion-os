import { useEffect, useState } from "react";

import type {
  StreamEvent,
  StreamReactionPreferences,
  StreamSettings,
} from "../streamApi";

type StreamIntegrationSettingsProps = {
  settings: StreamSettings | null;
  recentEvents: StreamEvent[];
  notice: string | null;
  isSaving: boolean;
  onSave: (payload: Partial<StreamSettings>) => Promise<void>;
  onPreview: (type: keyof StreamReactionPreferences) => Promise<void>;
  onClearEvents: () => Promise<void>;
};

export function StreamIntegrationSettings({
  settings,
  recentEvents,
  notice,
  isSaving,
  onSave,
  onPreview,
  onClearEvents,
}: StreamIntegrationSettingsProps) {
  const [draft, setDraft] = useState<StreamSettings | null>(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  if (draft === null) {
    return null;
  }

  return (
    <section className="stream-settings">
      <div className="stream-settings__header">
        <div>
          <span className="eyebrow">Stream</span>
          <h3>Overlay and live reactions</h3>
        </div>
        <span
          className={`settings-health settings-health--${
            draft.enabled ? "ready" : "needs-attention"
          }`}
        >
          {draft.enabled ? "Live reactions on" : "Live reactions off"}
        </span>
      </div>

      <div className="stream-settings__grid">
        <article className="settings-card">
          <span className="settings-card__label">Connection</span>
          <label className="memory-settings__toggle">
            <input
              checked={draft.enabled}
              type="checkbox"
              onChange={(event) => {
                setDraft((current) =>
                  current === null
                    ? current
                    : {
                        ...current,
                        enabled: event.target.checked,
                      },
                );
              }}
            />
            <span>Enable stream integration</span>
          </label>
          <label className="installer-label" htmlFor="stream-provider">
            Stream provider
          </label>
          <select
            id="stream-provider"
            className="installer-select"
            value={draft.provider}
            onChange={(event) => {
              const provider = event.target.value as "twitch" | "youtube";
              setDraft((current) =>
                current === null
                  ? current
                  : {
                      ...current,
                      provider,
                    },
              );
            }}
          >
            <option value="twitch">Twitch</option>
            <option value="youtube">YouTube</option>
          </select>
          {draft.provider === "twitch" ? (
            <>
              <label className="installer-label" htmlFor="twitch-channel-name">
                Twitch channel
              </label>
              <input
                id="twitch-channel-name"
                className="memory-summary-card__title-input"
                placeholder="channel name"
                value={draft.twitch_channel_name}
                onChange={(event) => {
                  setDraft((current) =>
                    current === null
                      ? current
                      : {
                          ...current,
                          twitch_channel_name: event.target.value,
                        },
                  );
                }}
              />
              <label className="installer-label" htmlFor="twitch-secret">
                EventSub secret
              </label>
              <input
                id="twitch-secret"
                className="memory-summary-card__title-input"
                placeholder="local webhook secret"
                value={draft.twitch_webhook_secret}
                onChange={(event) => {
                  setDraft((current) =>
                    current === null
                      ? current
                      : {
                          ...current,
                          twitch_webhook_secret: event.target.value,
                        },
                  );
                }}
              />
            </>
          ) : (
            <>
              <label className="installer-label" htmlFor="youtube-chat-id">
                YouTube live chat id
              </label>
              <input
                id="youtube-chat-id"
                className="memory-summary-card__title-input"
                placeholder="live chat id"
                value={draft.youtube_live_chat_id}
                onChange={(event) => {
                  setDraft((current) =>
                    current === null
                      ? current
                      : {
                          ...current,
                          youtube_live_chat_id: event.target.value,
                        },
                  );
                }}
              />
            </>
          )}
        </article>

        <article className="settings-card">
          <span className="settings-card__label">Overlay</span>
          <label className="memory-settings__toggle">
            <input
              checked={draft.overlay_enabled}
              type="checkbox"
              onChange={(event) => {
                const overlayEnabled = event.target.checked;
                setDraft((current) =>
                  current === null
                    ? current
                    : {
                        ...current,
                        overlay_enabled: overlayEnabled,
                        click_through_enabled: overlayEnabled
                          ? current.click_through_enabled
                          : false,
                      },
                );
              }}
            />
            <span>Show a transparent overlay on top of the desktop</span>
          </label>
          <label className="memory-settings__toggle">
            <input
              checked={draft.click_through_enabled}
              disabled={!draft.overlay_enabled}
              type="checkbox"
              onChange={(event) => {
                setDraft((current) =>
                  current === null
                    ? current
                    : {
                        ...current,
                        click_through_enabled: event.target.checked,
                      },
                );
              }}
            />
            <span>Let mouse clicks pass through the overlay</span>
          </label>
          <p className="settings-card__hint">
            Press <strong>Escape</strong> after refocusing Companion OS if you
            need to turn click-through off quickly.
          </p>
        </article>
      </div>

      <div className="stream-settings__toggles">
        <label className="memory-settings__toggle">
          <input
            checked={draft.reaction_preferences.new_subscriber}
            type="checkbox"
            onChange={(event) => {
              setDraft((current) =>
                current === null
                  ? current
                  : {
                      ...current,
                      reaction_preferences: {
                        ...current.reaction_preferences,
                        new_subscriber: event.target.checked,
                      },
                    },
              );
            }}
          />
          <span>React to new subscribers</span>
        </label>
        <label className="memory-settings__toggle">
          <input
            checked={draft.reaction_preferences.donation}
            type="checkbox"
            onChange={(event) => {
              setDraft((current) =>
                current === null
                  ? current
                  : {
                      ...current,
                      reaction_preferences: {
                        ...current.reaction_preferences,
                        donation: event.target.checked,
                      },
                    },
              );
            }}
          />
          <span>React to donations and cheers</span>
        </label>
        <label className="memory-settings__toggle">
          <input
            checked={draft.reaction_preferences.new_member}
            type="checkbox"
            onChange={(event) => {
              setDraft((current) =>
                current === null
                  ? current
                  : {
                      ...current,
                      reaction_preferences: {
                        ...current.reaction_preferences,
                        new_member: event.target.checked,
                      },
                    },
              );
            }}
          />
          <span>React to new YouTube members</span>
        </label>
        <label className="memory-settings__toggle">
          <input
            checked={draft.reaction_preferences.super_chat}
            type="checkbox"
            onChange={(event) => {
              setDraft((current) =>
                current === null
                  ? current
                  : {
                      ...current,
                      reaction_preferences: {
                        ...current.reaction_preferences,
                        super_chat: event.target.checked,
                      },
                    },
              );
            }}
          />
          <span>React to Super Chats</span>
        </label>
      </div>

      <div className="stream-settings__actions">
        <button
          className="settings-action-button settings-action-button--primary"
          disabled={isSaving}
          type="button"
          onClick={() => {
            void onSave(draft);
          }}
        >
          {isSaving ? "Saving stream setup..." : "Save stream setup"}
        </button>
        <button
          className="settings-action-button"
          disabled={isSaving}
          type="button"
          onClick={() => {
            void onPreview(
              draft.provider === "youtube" ? "new_member" : "new_subscriber",
            );
          }}
        >
          {draft.provider === "youtube" ? "Preview member" : "Preview subscriber"}
        </button>
        <button
          className="settings-action-button"
          disabled={isSaving}
          type="button"
          onClick={() => {
            void onPreview(
              draft.provider === "youtube" ? "super_chat" : "donation",
            );
          }}
        >
          Preview support event
        </button>
        <button
          className="settings-action-button"
          disabled={isSaving || recentEvents.length === 0}
          type="button"
          onClick={() => {
            void onClearEvents();
          }}
        >
          Clear recent events
        </button>
      </div>

      {notice ? (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="stream-event-list" aria-label="Recent stream events">
        {recentEvents.length === 0 ? (
          <p className="utility-column__empty">
            No stream events have reached the companion yet.
          </p>
        ) : (
          recentEvents.slice(0, 5).map((event) => (
            <article className="stream-event-card" key={event.id}>
              <div className="stream-event-card__header">
                <strong>{event.actor_name}</strong>
                <span className="pack-card__badge pack-card__badge--available">
                  {event.provider}
                </span>
              </div>
              <p>{event.bubble_text}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
