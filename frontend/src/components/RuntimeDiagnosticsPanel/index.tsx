import { useRuntimeDiagnostics } from "@src/components/RuntimeDiagnosticsPanel/hooks/useRuntimeDiagnostics";
import { useRuntimeDiagnosticsShortcuts } from "@src/components/RuntimeDiagnosticsPanel/hooks/useRuntimeDiagnosticsShortcuts";
import { RuntimeDiagnosticsHeader } from "@src/components/RuntimeDiagnosticsPanel/RuntimeDiagnosticsHeader";
import { RuntimeHealthSummary } from "@src/components/RuntimeDiagnosticsPanel/RuntimeHealthSummary";
import { RuntimePollingControls } from "@src/components/RuntimeDiagnosticsPanel/RuntimePollingControls";
import { RuntimeRetentionPolicyPanel } from "@src/components/RuntimeDiagnosticsPanel/RuntimeRetentionPolicyPanel";
import { RuntimeShortcutsHelp } from "@src/components/RuntimeDiagnosticsPanel/RuntimeShortcutsHelp";

export function RuntimeDiagnosticsPanel(): React.JSX.Element {
  const {
    health,
    retention,
    retentionAudit,
    pollIntervalMs,
    pollPaused,
    maxHistoryCountInput,
    maxAgeDaysInput,
    pruneIntervalMsInput,
    retentionInputsDirty,
    lastUpdatedAt,
    error,
    serverFieldErrors,
    loading,
    savingPolicy,
    fieldErrors,
    hasFieldErrors,
    staleness,
    setPollIntervalMs,
    togglePollPaused,
    onMaxHistoryCountInputChange,
    onMaxAgeDaysInputChange,
    onPruneIntervalMsInputChange,
    resetRetentionInputs,
    saveRetentionPolicy,
    refresh,
  } = useRuntimeDiagnostics();

  const { shortcutStatus, shortcutStepMs, onPanelKeyDown } =
    useRuntimeDiagnosticsShortcuts({
      pollIntervalMs,
      pollPaused,
      setPollIntervalMs,
      togglePollPaused,
      refresh,
    });

  return (
    <section
      className="runtime-diagnostics-panel runtime-diagnostics-shell"
      tabIndex={0}
      onKeyDown={onPanelKeyDown}
      aria-label="Runtime diagnostics with keyboard shortcuts"
    >
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {shortcutStatus}
      </p>

      <RuntimeShortcutsHelp shortcutStepMs={shortcutStepMs} />

      <RuntimeDiagnosticsHeader
        loading={loading}
        savingPolicy={savingPolicy}
        onRefresh={() => void refresh()}
      />

      <RuntimePollingControls
        pollIntervalMs={pollIntervalMs}
        pollPaused={pollPaused}
        onPollIntervalChange={setPollIntervalMs}
        onTogglePollPaused={togglePollPaused}
      />

      <p className={`runtime-diagnostics-freshness ${staleness}`}>
        Data Status: {staleness}
        {lastUpdatedAt
          ? ` (last updated ${new Date(lastUpdatedAt).toLocaleTimeString()})`
          : ""}
      </p>

      {error ? <p>{error}</p> : null}

      <RuntimeHealthSummary health={health} />

      <RuntimeRetentionPolicyPanel
        retention={retention}
        retentionAudit={retentionAudit}
        maxHistoryCountInput={maxHistoryCountInput}
        maxAgeDaysInput={maxAgeDaysInput}
        pruneIntervalMsInput={pruneIntervalMsInput}
        retentionInputsDirty={retentionInputsDirty}
        fieldErrors={fieldErrors}
        serverFieldErrors={serverFieldErrors}
        hasFieldErrors={hasFieldErrors}
        savingPolicy={savingPolicy}
        onMaxHistoryCountInputChange={onMaxHistoryCountInputChange}
        onMaxAgeDaysInputChange={onMaxAgeDaysInputChange}
        onPruneIntervalMsInputChange={onPruneIntervalMsInputChange}
        onSaveRetentionPolicy={() => void saveRetentionPolicy()}
        onResetRetentionInputs={resetRetentionInputs}
      />
    </section>
  );
}
