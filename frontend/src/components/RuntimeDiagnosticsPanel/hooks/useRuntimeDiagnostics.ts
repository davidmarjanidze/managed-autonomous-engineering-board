import { useCallback, useEffect, useMemo, useState } from "react";

import { getRuntimeHealth, type RuntimeHealth } from "@src/services/sessions";
import {
  getApprovalRetentionAudit,
  getApprovalRetentionStatus,
  updateApprovalRetentionStatus,
  type ApprovalRetentionAuditEntry,
  type ApprovalRetentionStatus,
} from "@src/services/tasks";

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export interface RetentionFieldErrors {
  maxHistoryCount?: string;
  maxAgeDays?: string;
  pruneIntervalMs?: string;
}

export interface UseRuntimeDiagnosticsResult {
  health: RuntimeHealth | null;
  retention: ApprovalRetentionStatus | null;
  retentionAudit: ApprovalRetentionAuditEntry[];
  pollIntervalMs: number;
  pollPaused: boolean;
  maxHistoryCountInput: string;
  maxAgeDaysInput: string;
  pruneIntervalMsInput: string;
  retentionInputsDirty: boolean;
  lastUpdatedAt: string | null;
  error: string | null;
  serverFieldErrors: RetentionFieldErrors;
  loading: boolean;
  savingPolicy: boolean;
  fieldErrors: RetentionFieldErrors;
  hasFieldErrors: boolean;
  staleness: "stale" | "fresh";
  setPollIntervalMs: (next: number) => void;
  togglePollPaused: () => void;
  onMaxHistoryCountInputChange: (value: string) => void;
  onMaxAgeDaysInputChange: (value: string) => void;
  onPruneIntervalMsInputChange: (value: string) => void;
  resetRetentionInputs: () => void;
  saveRetentionPolicy: () => Promise<void>;
  refresh: () => Promise<void>;
}

function mapServerFieldErrors(message: string): RetentionFieldErrors {
  return {
    maxHistoryCount: message.includes("maxHistoryCount") ? message : undefined,
    maxAgeDays: message.includes("maxAgeDays") ? message : undefined,
    pruneIntervalMs: message.includes("pruneIntervalMs") ? message : undefined,
  };
}

export function useRuntimeDiagnostics(): UseRuntimeDiagnosticsResult {
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [retention, setRetention] = useState<ApprovalRetentionStatus | null>(
    null,
  );
  const [retentionAudit, setRetentionAudit] = useState<
    ApprovalRetentionAuditEntry[]
  >([]);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(
    DEFAULT_POLL_INTERVAL_MS,
  );
  const [pollPaused, setPollPaused] = useState<boolean>(false);
  const [maxHistoryCountInput, setMaxHistoryCountInput] =
    useState<string>("2000");
  const [maxAgeDaysInput, setMaxAgeDaysInput] = useState<string>("90");
  const [pruneIntervalMsInput, setPruneIntervalMsInput] =
    useState<string>("300000");
  const [retentionInputsDirty, setRetentionInputsDirty] =
    useState<boolean>(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] =
    useState<RetentionFieldErrors>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [savingPolicy, setSavingPolicy] = useState<boolean>(false);

  const maxHistoryCountValue = Number(maxHistoryCountInput);
  const maxAgeDaysValue = Number(maxAgeDaysInput);
  const pruneIntervalMsValue = Number(pruneIntervalMsInput);

  const fieldErrors = useMemo<RetentionFieldErrors>(
    () => ({
      maxHistoryCount:
        !Number.isFinite(maxHistoryCountValue) ||
        !Number.isInteger(maxHistoryCountValue)
          ? "Must be a whole number."
          : retention &&
              (maxHistoryCountValue < retention.bounds.maxHistoryCount.min ||
                maxHistoryCountValue > retention.bounds.maxHistoryCount.max)
            ? `Must be between ${retention.bounds.maxHistoryCount.min} and ${retention.bounds.maxHistoryCount.max}.`
            : undefined,
      maxAgeDays:
        !Number.isFinite(maxAgeDaysValue) || !Number.isInteger(maxAgeDaysValue)
          ? "Must be a whole number."
          : retention &&
              (maxAgeDaysValue < retention.bounds.maxAgeDays.min ||
                maxAgeDaysValue > retention.bounds.maxAgeDays.max)
            ? `Must be between ${retention.bounds.maxAgeDays.min} and ${retention.bounds.maxAgeDays.max}.`
            : undefined,
      pruneIntervalMs:
        !Number.isFinite(pruneIntervalMsValue) ||
        !Number.isInteger(pruneIntervalMsValue)
          ? "Must be a whole number."
          : retention &&
              (pruneIntervalMsValue < retention.bounds.pruneIntervalMs.min ||
                pruneIntervalMsValue > retention.bounds.pruneIntervalMs.max)
            ? `Must be between ${retention.bounds.pruneIntervalMs.min} and ${retention.bounds.pruneIntervalMs.max} ms.`
            : undefined,
    }),
    [maxAgeDaysValue, maxHistoryCountValue, pruneIntervalMsValue, retention],
  );

  const hasFieldErrors = Boolean(
    fieldErrors.maxHistoryCount ||
    fieldErrors.maxAgeDays ||
    fieldErrors.pruneIntervalMs,
  );

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [nextHealth, nextRetention] = await Promise.all([
        getRuntimeHealth(),
        getApprovalRetentionStatus(),
      ]);
      const nextAudit = await getApprovalRetentionAudit(15);
      setHealth(nextHealth);
      setRetention(nextRetention);
      setRetentionAudit(nextAudit);
      if (!retentionInputsDirty) {
        setMaxHistoryCountInput(String(nextRetention.maxHistoryCount));
        setMaxAgeDaysInput(String(nextRetention.maxAgeDays));
        setPruneIntervalMsInput(String(nextRetention.pruneIntervalMs));
      }
      setLastUpdatedAt(new Date().toISOString());
      setServerFieldErrors({});
      setError(null);
    } catch {
      setError("Failed to load runtime diagnostics.");
    } finally {
      setLoading(false);
    }
  }, [retentionInputsDirty]);

  useEffect(() => {
    void refresh();

    if (pollPaused) {
      return;
    }

    const timer = setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [pollIntervalMs, pollPaused, refresh]);

  const resetRetentionInputs = (): void => {
    if (!retention) {
      return;
    }

    setMaxHistoryCountInput(String(retention.maxHistoryCount));
    setMaxAgeDaysInput(String(retention.maxAgeDays));
    setPruneIntervalMsInput(String(retention.pruneIntervalMs));
    setRetentionInputsDirty(false);
    setServerFieldErrors({});
    setError(null);
  };

  const saveRetentionPolicy = async (): Promise<void> => {
    if (hasFieldErrors) {
      setError("Fix validation errors before saving retention policy.");
      return;
    }

    setSavingPolicy(true);
    try {
      const updated = await updateApprovalRetentionStatus({
        maxHistoryCount: maxHistoryCountValue,
        maxAgeDays: maxAgeDaysValue,
        pruneIntervalMs: pruneIntervalMsValue,
        actor: "board-ui",
        source: "runtime-diagnostics-panel",
      });
      const nextAudit = await getApprovalRetentionAudit(15);
      setRetention(updated);
      setRetentionAudit(nextAudit);
      setMaxHistoryCountInput(String(updated.maxHistoryCount));
      setMaxAgeDaysInput(String(updated.maxAgeDays));
      setPruneIntervalMsInput(String(updated.pruneIntervalMs));
      setRetentionInputsDirty(false);
      setServerFieldErrors({});
      setLastUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to update approval retention policy.";
      const mapped = mapServerFieldErrors(message);
      const hasMapped = Boolean(
        mapped.maxHistoryCount || mapped.maxAgeDays || mapped.pruneIntervalMs,
      );
      setServerFieldErrors(mapped);
      setError(hasMapped ? "Review highlighted field errors." : message);
    } finally {
      setSavingPolicy(false);
    }
  };

  const staleAfterMs = pollIntervalMs * 2;
  const staleness: "stale" | "fresh" =
    lastUpdatedAt && Date.now() - Date.parse(lastUpdatedAt) > staleAfterMs
      ? "stale"
      : "fresh";

  return {
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
    togglePollPaused: () => setPollPaused((current) => !current),
    onMaxHistoryCountInputChange: (value: string) => {
      setRetentionInputsDirty(true);
      setServerFieldErrors((current) => ({
        ...current,
        maxHistoryCount: undefined,
      }));
      setMaxHistoryCountInput(value);
    },
    onMaxAgeDaysInputChange: (value: string) => {
      setRetentionInputsDirty(true);
      setServerFieldErrors((current) => ({
        ...current,
        maxAgeDays: undefined,
      }));
      setMaxAgeDaysInput(value);
    },
    onPruneIntervalMsInputChange: (value: string) => {
      setRetentionInputsDirty(true);
      setServerFieldErrors((current) => ({
        ...current,
        pruneIntervalMs: undefined,
      }));
      setPruneIntervalMsInput(value);
    },
    resetRetentionInputs,
    saveRetentionPolicy,
    refresh,
  };
}
