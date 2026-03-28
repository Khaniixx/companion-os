import { useEffect, useState } from "react";

import {
  memoryApi as defaultMemoryApi,
  type MemoryApi,
  type MemorySummary,
} from "../memoryApi";

type MemoryPrivacySettingsProps = {
  memoryApi?: MemoryApi;
};

const SUMMARY_FREQUENCY_OPTIONS = [10, 25, 50, 100];

function formatTimestamp(value: string): string {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Recently";
  }
  return parsedDate.toLocaleString();
}

export function MemoryPrivacySettings({
  memoryApi = defaultMemoryApi,
}: MemoryPrivacySettingsProps) {
  const [longTermMemoryEnabled, setLongTermMemoryEnabled] = useState(true);
  const [summaryFrequency, setSummaryFrequency] = useState(25);
  const [cloudBackupEnabled, setCloudBackupEnabled] = useState(false);
  const [pendingMessageCount, setPendingMessageCount] = useState(0);
  const [summaries, setSummaries] = useState<MemorySummary[]>([]);
  const [editingSummaryId, setEditingSummaryId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [busySummaryId, setBusySummaryId] = useState<number | null>(null);
  const [isClearingSummaries, setIsClearingSummaries] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshMemoryState(): Promise<void> {
    const [settings, summaryState] = await Promise.all([
      memoryApi.getSettings(),
      memoryApi.listSummaries(),
    ]);
    setLongTermMemoryEnabled(settings.long_term_memory_enabled);
    setSummaryFrequency(settings.summary_frequency_messages);
    setCloudBackupEnabled(settings.cloud_backup_enabled);
    setPendingMessageCount(summaryState.pending_message_count);
    setSummaries(summaryState.summaries);
  }

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      try {
        const [settings, summaryState] = await Promise.all([
          memoryApi.getSettings(),
          memoryApi.listSummaries(),
        ]);
        if (!active) {
          return;
        }

        setLongTermMemoryEnabled(settings.long_term_memory_enabled);
        setSummaryFrequency(settings.summary_frequency_messages);
        setCloudBackupEnabled(settings.cloud_backup_enabled);
        setPendingMessageCount(summaryState.pending_message_count);
        setSummaries(summaryState.summaries);
      } catch (loadError) {
        if (!active) {
          return;
        }

        const detail =
          loadError instanceof Error ? loadError.message : "Unknown memory loading error";
        setError(detail);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [memoryApi]);

  async function persistSettings(
    overrides: Partial<{
      long_term_memory_enabled: boolean;
      summary_frequency_messages: number;
      cloud_backup_enabled: boolean;
    }>,
  ): Promise<void> {
    try {
      setIsSavingSettings(true);
      setError(null);
      const settings = await memoryApi.updateSettings(overrides);
      setLongTermMemoryEnabled(settings.long_term_memory_enabled);
      setSummaryFrequency(settings.summary_frequency_messages);
      setCloudBackupEnabled(settings.cloud_backup_enabled);

      const summaryState = await memoryApi.listSummaries();
      setPendingMessageCount(summaryState.pending_message_count);
      setSummaries(summaryState.summaries);

      if (overrides.long_term_memory_enabled === false) {
        setNotice("Long-term memory is off. New conversations stay in the live session only.");
      } else if (overrides.long_term_memory_enabled === true) {
        setNotice("Long-term memory is on. Summaries will stay local on this device.");
      } else if (overrides.cloud_backup_enabled !== undefined) {
        setNotice(
          overrides.cloud_backup_enabled
            ? "Cloud backup is now opt-in only. The MVP still keeps memory local by default."
            : "Cloud backup is off. Memory stays local on this device.",
        );
      } else if (overrides.summary_frequency_messages !== undefined) {
        setNotice(
          `The companion will summarize local memory every ${settings.summary_frequency_messages} messages.`,
        );
      }
    } catch (saveError) {
      const detail =
        saveError instanceof Error ? saveError.message : "Unknown memory settings error";
      setError(detail);
    } finally {
      setIsSavingSettings(false);
    }
  }

  function startEditing(summary: MemorySummary): void {
    setEditingSummaryId(summary.id);
    setDraftTitle(summary.title);
    setDraftSummary(summary.summary);
  }

  async function saveSummary(summaryId: number): Promise<void> {
    try {
      setBusySummaryId(summaryId);
      setError(null);
      await memoryApi.updateSummary(summaryId, {
        title: draftTitle,
        summary: draftSummary,
      });
      await refreshMemoryState();
      setEditingSummaryId(null);
      setNotice("That memory summary was updated locally.");
    } catch (saveError) {
      const detail =
        saveError instanceof Error ? saveError.message : "Unknown memory update error";
      setError(detail);
    } finally {
      setBusySummaryId(null);
    }
  }

  async function removeSummary(summaryId: number): Promise<void> {
    try {
      setBusySummaryId(summaryId);
      setError(null);
      await memoryApi.deleteSummary(summaryId);
      await refreshMemoryState();
      setNotice("That memory summary was removed from this device.");
    } catch (deleteError) {
      const detail =
        deleteError instanceof Error ? deleteError.message : "Unknown memory delete error";
      setError(detail);
    } finally {
      setBusySummaryId(null);
    }
  }

  async function clearAllSummaries(): Promise<void> {
    try {
      setIsClearingSummaries(true);
      setError(null);
      const response = await memoryApi.clearSummaries();
      await refreshMemoryState();
      setEditingSummaryId(null);
      setNotice(
        response.deleted > 0
          ? `Removed ${response.deleted} saved memory summaries from this device.`
          : "Cleared pending local memory and left no saved summaries behind.",
      );
    } catch (clearError) {
      const detail =
        clearError instanceof Error ? clearError.message : "Unknown memory clear error";
      setError(detail);
    } finally {
      setIsClearingSummaries(false);
    }
  }

  return (
    <section className="memory-settings" aria-label="Memory and privacy">
      <div className="memory-settings__header">
        <div>
          <span className="eyebrow">Memory & Privacy</span>
          <h3>Keep long-term memory local and under your control.</h3>
        </div>
        <span
          className={`settings-health settings-health--${
            longTermMemoryEnabled ? "ready" : "needs-attention"
          }`}
        >
          {longTermMemoryEnabled ? "Long-term memory on" : "Long-term memory off"}
        </span>
      </div>

      <div className="memory-settings__grid">
        <article className="settings-card">
          <span className="settings-card__label">Storage</span>
          <p>
            Memory summaries are stored locally by default. Cloud backup is always
            opt-in.
          </p>
          <div className="memory-settings__toggle-list">
            <label className="memory-settings__toggle">
              <input
                type="checkbox"
                checked={longTermMemoryEnabled}
                disabled={isSavingSettings}
                onChange={(event) => {
                  setLongTermMemoryEnabled(event.target.checked);
                  void persistSettings({
                    long_term_memory_enabled: event.target.checked,
                  });
                }}
              />
              <span>Enable long-term memory summaries</span>
            </label>
            <label className="memory-settings__toggle">
              <input
                type="checkbox"
                checked={cloudBackupEnabled}
                disabled={isSavingSettings}
                onChange={(event) => {
                  setCloudBackupEnabled(event.target.checked);
                  void persistSettings({
                    cloud_backup_enabled: event.target.checked,
                  });
                }}
              />
              <span>Allow future cloud backup opt-in</span>
            </label>
          </div>
        </article>

        <article className="settings-card">
          <span className="settings-card__label">Summary cadence</span>
          <p>
            Turn recent conversation into a local summary every few messages instead of
            storing everything forever.
          </p>
          <label className="installer-label" htmlFor="summary-frequency">
            Summarize after
          </label>
          <select
            id="summary-frequency"
            className="installer-select"
            value={summaryFrequency}
            disabled={isSavingSettings}
            onChange={(event) => {
              const nextFrequency = Number(event.target.value);
              setSummaryFrequency(nextFrequency);
              void persistSettings({
                summary_frequency_messages: nextFrequency,
              });
            }}
          >
            {SUMMARY_FREQUENCY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} messages
              </option>
            ))}
          </select>
          <p className="settings-panel__hint">
            Pending local messages waiting for summarization:{" "}
            <strong>{pendingMessageCount}</strong>
          </p>
        </article>
      </div>

      <div className="memory-settings__actions">
        <button
          className="settings-action-button"
          disabled={isClearingSummaries}
          type="button"
          onClick={() => {
            void clearAllSummaries();
          }}
        >
          {isClearingSummaries ? "Clearing memory..." : "Clear saved memories"}
        </button>
      </div>

      {isLoading ? (
        <p className="settings-panel__hint">Loading local memory summaries.</p>
      ) : summaries.length === 0 ? (
        <div className="settings-card">
          <span className="settings-card__label">Local summaries</span>
          <p>
            No long-term memory summaries have been saved yet. Once enough conversation
            accumulates, the companion will condense it here instead of keeping every
            raw message forever.
          </p>
        </div>
      ) : (
        <div className="memory-summary-list">
          {summaries.map((summary) => {
            const isEditing = editingSummaryId === summary.id;
            const isBusyForSummary = busySummaryId === summary.id;

            return (
              <article className="memory-summary-card" key={summary.id}>
                <div className="memory-summary-card__header">
                  <div>
                    {isEditing ? (
                      <input
                        className="memory-summary-card__title-input"
                        aria-label={`Memory title ${summary.id}`}
                        value={draftTitle}
                        onChange={(event) => {
                          setDraftTitle(event.target.value);
                        }}
                      />
                    ) : (
                      <strong>{summary.title}</strong>
                    )}
                    <p>
                      {summary.message_count} messages • Updated{" "}
                      {formatTimestamp(summary.updated_at)}
                    </p>
                  </div>
                  <span className="pack-card__badge pack-card__badge--available">
                    {summary.source}
                  </span>
                </div>

                {isEditing ? (
                  <textarea
                    className="memory-summary-card__editor"
                    aria-label={`Memory summary ${summary.id}`}
                    rows={4}
                    value={draftSummary}
                    onChange={(event) => {
                      setDraftSummary(event.target.value);
                    }}
                  />
                ) : (
                  <p className="memory-summary-card__copy">{summary.summary}</p>
                )}

                <div className="memory-summary-card__actions">
                  {isEditing ? (
                    <>
                      <button
                        className="settings-action-button settings-action-button--primary"
                        disabled={isBusyForSummary}
                        type="button"
                        onClick={() => {
                          void saveSummary(summary.id);
                        }}
                      >
                        {isBusyForSummary ? "Saving..." : "Save memory"}
                      </button>
                      <button
                        className="settings-action-button"
                        disabled={isBusyForSummary}
                        type="button"
                        onClick={() => {
                          setEditingSummaryId(null);
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="settings-action-button"
                        disabled={busySummaryId !== null}
                        type="button"
                        onClick={() => {
                          startEditing(summary);
                        }}
                      >
                        Edit summary
                      </button>
                      <button
                        className="settings-action-button"
                        disabled={isBusyForSummary}
                        type="button"
                        onClick={() => {
                          void removeSummary(summary.id);
                        }}
                      >
                        {isBusyForSummary ? "Deleting..." : "Delete summary"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {notice ? (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="installer-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
