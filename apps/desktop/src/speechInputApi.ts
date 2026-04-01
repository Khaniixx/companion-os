export type SpeechInputSettings = {
  enabled: boolean;
  transcription_enabled: boolean;
  available: boolean;
  state: "ready" | "disabled" | string;
  provider: string;
  locale: string | null;
  display_name: string;
  message: string;
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

export const speechInputApi = {
  getSettings: () => request<SpeechInputSettings>("/api/preferences/speech-input"),
  updateSettings: (
    payload: Partial<Pick<SpeechInputSettings, "enabled" | "transcription_enabled">>,
  ) =>
    request<SpeechInputSettings>("/api/preferences/speech-input", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
