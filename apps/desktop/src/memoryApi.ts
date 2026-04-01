export type MemorySettings = {
  long_term_memory_enabled: boolean;
  summary_frequency_messages: number;
  cloud_backup_enabled: boolean;
  storage_mode: string;
};

export type MemorySummary = {
  id: number;
  title: string;
  summary: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  source: string;
};

export type MemorySummaryList = {
  summaries: MemorySummary[];
  pending_message_count: number;
  shared_summaries: MemorySummary[];
  shared_pending_message_count: number;
  active_pack_id: string | null;
  pack_summaries: MemorySummary[];
  pack_pending_message_count: number;
};

export type MemoryApi = {
  getSettings: () => Promise<MemorySettings>;
  updateSettings: (
    payload: Partial<Pick<
      MemorySettings,
      "long_term_memory_enabled" | "summary_frequency_messages" | "cloud_backup_enabled"
    >>,
  ) => Promise<MemorySettings>;
  listSummaries: () => Promise<MemorySummaryList>;
  updateSummary: (
    summaryId: number,
    payload: { title?: string; summary?: string },
  ) => Promise<MemorySummary>;
  deleteSummary: (summaryId: number) => Promise<{ deleted: number }>;
  clearSummaries: () => Promise<{ deleted: number }>;
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

export const memoryApi: MemoryApi = {
  getSettings: () => request<MemorySettings>("/api/memory/settings"),
  updateSettings: (payload) =>
    request<MemorySettings>("/api/memory/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  listSummaries: () => request<MemorySummaryList>("/api/memory/summaries"),
  updateSummary: (summaryId, payload) =>
    request<MemorySummary>(`/api/memory/summaries/${summaryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deleteSummary: (summaryId) =>
    request<{ deleted: number }>(`/api/memory/summaries/${summaryId}`, {
      method: "DELETE",
    }),
  clearSummaries: () =>
    request<{ deleted: number }>("/api/memory/summaries", {
      method: "DELETE",
    }),
};
