import { useCallback, useEffect, useMemo, useState } from "react";

import {
  RUNTIME_SUMMARY_CLOCK_TICK_MS,
  RUNTIME_SUMMARY_STALE_AFTER_MS,
} from "@src/components/Board/constants";
import { formatRelativeAge } from "@src/components/Board/utils";
import { getRuntimeHealth, type RuntimeHealth } from "@src/services/sessions";

export interface UseBoardRuntimeSummaryResult {
  runtimeHealth: RuntimeHealth | null;
  runtimeHealthRefreshing: boolean;
  runtimeHealthUpdatedAt: string | null;
  runtimeHealthRefreshError: string | null;
  runtimeSummaryFreshness: "fresh" | "stale" | "unknown";
  runtimeSummaryRelativeAge: string | null;
  refreshRuntimeSummary: () => Promise<void>;
  setRuntimeSnapshot: (runtime: RuntimeHealth | null) => void;
}

export function useBoardRuntimeSummary(): UseBoardRuntimeSummaryResult {
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(
    null,
  );
  const [runtimeHealthRefreshing, setRuntimeHealthRefreshing] =
    useState<boolean>(false);
  const [runtimeHealthUpdatedAt, setRuntimeHealthUpdatedAt] = useState<
    string | null
  >(null);
  const [runtimeHealthRefreshError, setRuntimeHealthRefreshError] = useState<
    string | null
  >(null);
  const [runtimeHealthNowMs, setRuntimeHealthNowMs] = useState<number>(
    Date.now(),
  );

  const setRuntimeSnapshot = useCallback(
    (runtime: RuntimeHealth | null): void => {
      setRuntimeHealth(runtime);
      setRuntimeHealthRefreshError(null);
      setRuntimeHealthUpdatedAt(runtime ? new Date().toISOString() : null);
    },
    [],
  );

  const refreshRuntimeSummary = useCallback(async (): Promise<void> => {
    setRuntimeHealthRefreshError(null);
    setRuntimeHealthRefreshing(true);
    try {
      const runtime = await getRuntimeHealth();
      setRuntimeHealth(runtime);
      setRuntimeHealthUpdatedAt(new Date().toISOString());
    } catch {
      setRuntimeHealthRefreshError("Failed to refresh runtime summary.");
    } finally {
      setRuntimeHealthRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setRuntimeHealthNowMs(Date.now());
    }, RUNTIME_SUMMARY_CLOCK_TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const runtimeSummaryFreshness = useMemo<"fresh" | "stale" | "unknown">(() => {
    if (!runtimeHealthUpdatedAt) {
      return "unknown";
    }

    const updatedAtMs = Date.parse(runtimeHealthUpdatedAt);
    if (Number.isNaN(updatedAtMs)) {
      return "unknown";
    }

    return runtimeHealthNowMs - updatedAtMs > RUNTIME_SUMMARY_STALE_AFTER_MS
      ? "stale"
      : "fresh";
  }, [runtimeHealthNowMs, runtimeHealthUpdatedAt]);

  const runtimeSummaryRelativeAge = useMemo<string | null>(() => {
    if (!runtimeHealthUpdatedAt) {
      return null;
    }

    const updatedAtMs = Date.parse(runtimeHealthUpdatedAt);
    if (Number.isNaN(updatedAtMs)) {
      return null;
    }

    return formatRelativeAge(Math.max(0, runtimeHealthNowMs - updatedAtMs));
  }, [runtimeHealthNowMs, runtimeHealthUpdatedAt]);

  return {
    runtimeHealth,
    runtimeHealthRefreshing,
    runtimeHealthUpdatedAt,
    runtimeHealthRefreshError,
    runtimeSummaryFreshness,
    runtimeSummaryRelativeAge,
    refreshRuntimeSummary,
    setRuntimeSnapshot,
  };
}
