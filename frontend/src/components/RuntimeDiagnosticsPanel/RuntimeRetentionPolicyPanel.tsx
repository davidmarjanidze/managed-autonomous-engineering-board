import type { RetentionFieldErrors } from "@src/components/RuntimeDiagnosticsPanel/hooks/useRuntimeDiagnostics";
import { formatRetentionAuditChange } from "@src/components/RuntimeDiagnosticsPanel/utils";
import type {
  ApprovalRetentionAuditEntry,
  ApprovalRetentionStatus,
} from "@src/services/tasks";

interface RuntimeRetentionPolicyPanelProps {
  retention: ApprovalRetentionStatus | null;
  retentionAudit: ApprovalRetentionAuditEntry[];
  maxHistoryCountInput: string;
  maxAgeDaysInput: string;
  pruneIntervalMsInput: string;
  retentionInputsDirty: boolean;
  fieldErrors: RetentionFieldErrors;
  serverFieldErrors: RetentionFieldErrors;
  hasFieldErrors: boolean;
  savingPolicy: boolean;
  onMaxHistoryCountInputChange: (value: string) => void;
  onMaxAgeDaysInputChange: (value: string) => void;
  onPruneIntervalMsInputChange: (value: string) => void;
  onSaveRetentionPolicy: () => void;
  onResetRetentionInputs: () => void;
}

export function RuntimeRetentionPolicyPanel({
  retention,
  retentionAudit,
  maxHistoryCountInput,
  maxAgeDaysInput,
  pruneIntervalMsInput,
  retentionInputsDirty,
  fieldErrors,
  serverFieldErrors,
  hasFieldErrors,
  savingPolicy,
  onMaxHistoryCountInputChange,
  onMaxAgeDaysInputChange,
  onPruneIntervalMsInputChange,
  onSaveRetentionPolicy,
  onResetRetentionInputs,
}: RuntimeRetentionPolicyPanelProps): React.JSX.Element | null {
  if (!retention) {
    return null;
  }

  return (
    <div className="runtime-retention-panel">
      <h3>Approval Retention</h3>
      <p>
        Policy: max {retention.maxHistoryCount} records, {retention.maxAgeDays}{" "}
        days
      </p>
      <p>
        Counters: total={retention.totalRequests}, pending=
        {retention.pendingRequests}, history={retention.retainedHistoryRequests}
      </p>
      <p>
        Last Prune:{" "}
        {retention.lastPrunedAt
          ? new Date(retention.lastPrunedAt).toLocaleString()
          : "not yet"}{" "}
        (removed {retention.lastPrunedCount})
      </p>
      <p>Prune Interval: {Math.round(retention.pruneIntervalMs / 1000)}s</p>
      <p>Update Cooldown: {retention.updateMinIntervalMs} ms</p>

      <div className="runtime-retention-controls">
        <label>
          Max Records
          <input
            type="number"
            min={1}
            step={1}
            value={maxHistoryCountInput}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onMaxHistoryCountInputChange(event.target.value)
            }
          />
          <span className="runtime-field-hint">
            Allowed: {retention.bounds.maxHistoryCount.min} to{" "}
            {retention.bounds.maxHistoryCount.max}
          </span>
          {fieldErrors.maxHistoryCount || serverFieldErrors.maxHistoryCount ? (
            <span className="runtime-field-error">
              {fieldErrors.maxHistoryCount ?? serverFieldErrors.maxHistoryCount}
            </span>
          ) : null}
        </label>
        <label>
          Max Age (days)
          <input
            type="number"
            min={1}
            step={1}
            value={maxAgeDaysInput}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onMaxAgeDaysInputChange(event.target.value)
            }
          />
          <span className="runtime-field-hint">
            Allowed: {retention.bounds.maxAgeDays.min} to{" "}
            {retention.bounds.maxAgeDays.max}
          </span>
          {fieldErrors.maxAgeDays || serverFieldErrors.maxAgeDays ? (
            <span className="runtime-field-error">
              {fieldErrors.maxAgeDays ?? serverFieldErrors.maxAgeDays}
            </span>
          ) : null}
        </label>
        <label>
          Prune Interval (ms)
          <input
            type="number"
            min={1000}
            step={1000}
            value={pruneIntervalMsInput}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onPruneIntervalMsInputChange(event.target.value)
            }
          />
          <span className="runtime-field-hint">
            Allowed: {retention.bounds.pruneIntervalMs.min} to{" "}
            {retention.bounds.pruneIntervalMs.max}
          </span>
          {fieldErrors.pruneIntervalMs || serverFieldErrors.pruneIntervalMs ? (
            <span className="runtime-field-error">
              {fieldErrors.pruneIntervalMs ?? serverFieldErrors.pruneIntervalMs}
            </span>
          ) : null}
        </label>
        <button
          type="button"
          onClick={onSaveRetentionPolicy}
          disabled={savingPolicy || !retentionInputsDirty || hasFieldErrors}
        >
          {savingPolicy ? "Saving..." : "Save Retention Policy"}
        </button>
        <button
          type="button"
          className="runtime-secondary-button"
          onClick={onResetRetentionInputs}
          disabled={!retentionInputsDirty || savingPolicy}
        >
          Reset to Server Values
        </button>
      </div>

      <p
        className={`runtime-retention-dirty ${retentionInputsDirty ? "dirty" : "clean"}`}
      >
        {retentionInputsDirty
          ? "Unsaved retention policy changes"
          : "Retention policy is in sync"}
      </p>

      <div className="runtime-retention-audit">
        <h4>Recent Policy Updates</h4>
        {retentionAudit.length === 0 ? (
          <p>No updates recorded yet.</p>
        ) : (
          <ul>
            {retentionAudit.map((entry) => (
              <li key={entry.id}>
                {new Date(entry.createdAt).toLocaleString()} | actor=
                {entry.actor} | source=
                {entry.source} | {formatRetentionAuditChange(entry)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
