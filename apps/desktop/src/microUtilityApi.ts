export type UtilityItem = {
  id: number;
  kind: string;
  label: string;
  due_at: string | null;
  completed: boolean;
  created_at: string;
};

export type ClipboardEntry = {
  id: number;
  text: string;
  created_at: string;
};

export type Shortcut = {
  id: string;
  label: string;
  kind: "app" | "browser" | string;
  target: string;
};

export type MicroUtilityState = {
  timers: UtilityItem[];
  reminders: UtilityItem[];
  todos: UtilityItem[];
  clipboard_history: ClipboardEntry[];
  shortcuts: Shortcut[];
};

export type MicroUtilityResponse = {
  ok: boolean;
  action: string;
  request: string;
  message: string;
  metadata: Record<string, unknown>;
};

export type ClipboardCaptureResponse = {
  id: number;
  text: string;
  created_at: string;
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

export const microUtilityApi = {
  getState: () => request<MicroUtilityState>("/api/utilities/state"),
  runRequest: (requestText: string) =>
    request<MicroUtilityResponse>("/api/skills/micro-utilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: requestText }),
    }),
  captureClipboard: (text: string) =>
    request<ClipboardCaptureResponse>("/api/utilities/clipboard/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
};
