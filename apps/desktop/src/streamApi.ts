export type StreamReactionPreferences = {
  new_subscriber: boolean;
  donation: boolean;
  new_member: boolean;
  super_chat: boolean;
};

export type StreamSettings = {
  enabled: boolean;
  provider: "twitch" | "youtube" | string;
  overlay_enabled: boolean;
  click_through_enabled: boolean;
  twitch_channel_name: string;
  twitch_webhook_secret: string;
  youtube_live_chat_id: string;
  reaction_preferences: StreamReactionPreferences;
};

export type StreamEvent = {
  id: number;
  provider: "twitch" | "youtube" | string;
  type: keyof StreamReactionPreferences | string;
  actor_name: string;
  amount_display: string | null;
  message: string | null;
  bubble_text: string;
  created_at: string;
  should_react: boolean;
};

export type StreamState = {
  settings: StreamSettings;
  recent_events: StreamEvent[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new Error(errorPayload?.detail ?? `Runtime returned ${response.status}`);
  }

  return (await response.json()) as T;
}

export const streamApi = {
  getState: () => request<StreamState>("/api/stream/state"),
  getEvents: () => request<StreamEvent[]>("/api/stream/events"),
  updateSettings: (payload: Partial<StreamSettings>) =>
    request<StreamSettings>("/api/stream/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  clearEvents: () =>
    request<{ deleted: number }>("/api/stream/events", {
      method: "DELETE",
    }),
  previewEvent: (type: keyof StreamReactionPreferences) =>
    request<StreamEvent>("/api/stream/events/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    }),
};
