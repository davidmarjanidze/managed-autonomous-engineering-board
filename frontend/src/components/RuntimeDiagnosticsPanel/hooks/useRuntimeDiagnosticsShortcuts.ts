import { useState } from "react";

const POLL_SHORTCUT_STEP_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 1_000;

interface UseRuntimeDiagnosticsShortcutsParams {
  pollIntervalMs: number;
  pollPaused: boolean;
  setPollIntervalMs: (next: number) => void;
  togglePollPaused: () => void;
  refresh: () => Promise<void>;
}

interface UseRuntimeDiagnosticsShortcutsResult {
  shortcutStatus: string;
  shortcutStepMs: number;
  onPanelKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

function isEditingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

export function useRuntimeDiagnosticsShortcuts({
  pollIntervalMs,
  pollPaused,
  setPollIntervalMs,
  togglePollPaused,
  refresh,
}: UseRuntimeDiagnosticsShortcutsParams): UseRuntimeDiagnosticsShortcutsResult {
  const [shortcutStatus, setShortcutStatus] = useState<string>(
    "Runtime diagnostics keyboard shortcuts enabled.",
  );

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (isEditingElement(event.target)) {
      return;
    }

    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      setShortcutStatus("Refreshing runtime diagnostics.");
      void refresh();
      return;
    }

    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      togglePollPaused();
      setShortcutStatus(pollPaused ? "Polling resumed." : "Polling paused.");
      return;
    }

    if (event.ctrlKey && event.key === "ArrowUp") {
      event.preventDefault();
      const nextPollInterval = pollIntervalMs + POLL_SHORTCUT_STEP_MS;
      setPollIntervalMs(nextPollInterval);
      setShortcutStatus(`Polling interval set to ${nextPollInterval} ms.`);
      return;
    }

    if (event.ctrlKey && event.key === "ArrowDown") {
      event.preventDefault();
      const nextPollInterval = Math.max(
        MIN_POLL_INTERVAL_MS,
        pollIntervalMs - POLL_SHORTCUT_STEP_MS,
      );
      setPollIntervalMs(nextPollInterval);
      setShortcutStatus(`Polling interval set to ${nextPollInterval} ms.`);
    }
  };

  return {
    shortcutStatus,
    shortcutStepMs: POLL_SHORTCUT_STEP_MS,
    onPanelKeyDown,
  };
}
