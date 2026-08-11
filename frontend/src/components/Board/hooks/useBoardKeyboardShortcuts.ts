import { useMemo, useState } from "react";

import { phases } from "@src/components/Board/constants";
import type { Task, TaskPhase } from "@src/services/tasks";

interface UseBoardKeyboardShortcutsParams {
  tasks: Task[];
  moveTaskToPhase: (taskId: string, phase: TaskPhase) => Promise<void>;
  refreshRuntimeSummary: () => Promise<void>;
}

interface UseBoardKeyboardShortcutsResult {
  activeTaskId: string | null;
  activePhase: TaskPhase;
  shortcutStatus: string;
  onSelectTask: (taskId: string) => void;
  onBoardKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
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

export function useBoardKeyboardShortcuts({
  tasks,
  moveTaskToPhase,
  refreshRuntimeSummary,
}: UseBoardKeyboardShortcutsParams): UseBoardKeyboardShortcutsResult {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activePhaseIndex, setActivePhaseIndex] = useState<number>(0);
  const [shortcutStatus, setShortcutStatus] = useState<string>(
    "Keyboard shortcuts enabled.",
  );

  const activePhase = phases[activePhaseIndex] ?? phases[0];

  const activeTask = useMemo(
    () => tasks.find((task: Task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  );

  const movePhaseFocus = (direction: -1 | 1): void => {
    setActivePhaseIndex((currentIndex) => {
      const nextIndex = Math.min(
        phases.length - 1,
        Math.max(0, currentIndex + direction),
      );

      if (nextIndex !== currentIndex) {
        setShortcutStatus(`Phase focus moved to ${phases[nextIndex]}.`);
      }

      return nextIndex;
    });
  };

  const moveActiveTask = async (direction: -1 | 1): Promise<void> => {
    if (!activeTask) {
      setShortcutStatus("Select a task card first to move it by keyboard.");
      return;
    }

    const currentPhaseIndex = phases.findIndex(
      (phase) => phase === activeTask.phase,
    );
    if (currentPhaseIndex === -1) {
      setShortcutStatus("Selected task phase is unavailable.");
      return;
    }

    const nextPhaseIndex = Math.min(
      phases.length - 1,
      Math.max(0, currentPhaseIndex + direction),
    );

    if (nextPhaseIndex === currentPhaseIndex) {
      setShortcutStatus(
        direction < 0
          ? "Task is already in the first phase."
          : "Task is already in the final phase.",
      );
      return;
    }

    const nextPhase = phases[nextPhaseIndex];
    await moveTaskToPhase(activeTask.id, nextPhase);
    setActivePhaseIndex(nextPhaseIndex);
    setShortcutStatus(`Moved task to ${nextPhase}.`);
  };

  const onBoardKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (isEditingElement(event.target)) {
      return;
    }

    if (event.ctrlKey && event.key === "ArrowRight") {
      event.preventDefault();
      movePhaseFocus(1);
      return;
    }

    if (event.ctrlKey && event.key === "ArrowLeft") {
      event.preventDefault();
      movePhaseFocus(-1);
      return;
    }

    if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      void moveActiveTask(1);
      return;
    }

    if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      void moveActiveTask(-1);
      return;
    }

    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      setShortcutStatus("Refreshing runtime summary.");
      void refreshRuntimeSummary();
    }
  };

  return {
    activeTaskId,
    activePhase,
    shortcutStatus,
    onSelectTask: setActiveTaskId,
    onBoardKeyDown,
  };
}
