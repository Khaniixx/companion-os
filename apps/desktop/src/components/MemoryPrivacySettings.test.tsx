import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MemoryPrivacySettings } from "./MemoryPrivacySettings";


function createMemoryApiMock() {
  const getSettings = vi.fn();
  const updateSettings = vi.fn();
  const listSummaries = vi.fn();
  const updateSummary = vi.fn();
  const deleteSummary = vi.fn();
  const clearSummaries = vi.fn();

  getSettings.mockResolvedValue({
    long_term_memory_enabled: true,
    summary_frequency_messages: 25,
    cloud_backup_enabled: false,
    storage_mode: "local-only",
  });

  listSummaries.mockResolvedValue({
    summaries: [
      {
        id: 1,
        title: "Recent: local setup",
        summary: "A local summary of the last setup conversation.",
        message_count: 6,
        created_at: "2026-03-29T00:00:00+00:00",
        updated_at: "2026-03-29T01:00:00+00:00",
        source: "local",
      },
    ],
    pending_message_count: 2,
    shared_summaries: [
      {
        id: 1,
        title: "Recent: local setup",
        summary: "A local summary of the last setup conversation.",
        message_count: 6,
        created_at: "2026-03-29T00:00:00+00:00",
        updated_at: "2026-03-29T01:00:00+00:00",
        source: "local",
      },
    ],
    shared_pending_message_count: 2,
    active_pack_id: null,
    pack_summaries: [],
    pack_pending_message_count: 0,
  });

  updateSettings.mockImplementation(async (payload) => ({
    long_term_memory_enabled:
      payload.long_term_memory_enabled ?? true,
    summary_frequency_messages:
      payload.summary_frequency_messages ?? 25,
    cloud_backup_enabled:
      payload.cloud_backup_enabled ?? false,
    storage_mode: "local-only",
  }));

  updateSummary.mockImplementation(async (_summaryId, payload) => ({
    id: 1,
    title: payload.title ?? "Recent: local setup",
    summary: payload.summary ?? "A local summary of the last setup conversation.",
    message_count: 6,
    created_at: "2026-03-29T00:00:00+00:00",
    updated_at: "2026-03-29T02:00:00+00:00",
    source: "local",
  }));

  deleteSummary.mockResolvedValue({ deleted: 1 });
  clearSummaries.mockResolvedValue({ deleted: 1 });

  return {
    getSettings,
    updateSettings,
    listSummaries,
    updateSummary,
    deleteSummary,
    clearSummaries,
  };
}


describe("MemoryPrivacySettings", () => {
  it("loads local memory settings and summaries", async () => {
    const memoryApi = createMemoryApiMock();

    render(<MemoryPrivacySettings memoryApi={memoryApi} />);

    expect(
      await screen.findByText("Keep long-term memory local and under your control."),
    ).toBeInTheDocument();
    expect(screen.getByText("A local summary of the last setup conversation.")).toBeInTheDocument();
    expect(screen.getByText("Pending local messages waiting for summarization:")).toBeInTheDocument();
  });

  it("updates memory settings and saves edited summaries", async () => {
    const memoryApi = createMemoryApiMock();
    const user = userEvent.setup();

    render(<MemoryPrivacySettings memoryApi={memoryApi} />);

    await screen.findByText("A local summary of the last setup conversation.");

    await user.click(screen.getByLabelText("Allow future cloud backup opt-in"));
    await waitFor(() => {
      expect(memoryApi.updateSettings).toHaveBeenCalledWith({
        cloud_backup_enabled: true,
      });
    });

    await user.selectOptions(screen.getByLabelText("Summarize after"), "50");
    await waitFor(() => {
      expect(memoryApi.updateSettings).toHaveBeenCalledWith({
        summary_frequency_messages: 50,
      });
    });

    await user.click(screen.getByRole("button", { name: "Edit summary" }));
    await user.clear(screen.getByLabelText("Memory title 1"));
    await user.type(screen.getByLabelText("Memory title 1"), "Edited memory");
    await user.clear(screen.getByLabelText("Memory summary 1"));
    await user.type(
      screen.getByLabelText("Memory summary 1"),
      "A revised local memory summary.",
    );
    await user.click(screen.getByRole("button", { name: "Save memory" }));

    await waitFor(() => {
      expect(memoryApi.updateSummary).toHaveBeenCalledWith(1, {
        title: "Edited memory",
        summary: "A revised local memory summary.",
      });
    });
  });

  it("deletes one summary and clears all saved memories", async () => {
    const memoryApi = createMemoryApiMock();
    const user = userEvent.setup();

    render(<MemoryPrivacySettings memoryApi={memoryApi} />);

    await screen.findByText("A local summary of the last setup conversation.");

    await user.click(screen.getByRole("button", { name: "Delete summary" }));
    await waitFor(() => {
      expect(memoryApi.deleteSummary).toHaveBeenCalledWith(1);
    });

    await user.click(screen.getByRole("button", { name: "Clear saved memories" }));
    await waitFor(() => {
      expect(memoryApi.clearSummaries).toHaveBeenCalled();
    });
  });
});
