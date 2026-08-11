import type { TaskPhase } from "@src/services/tasks";

interface BoardShortcutsHelpProps {
  activePhase: TaskPhase;
}

export function BoardShortcutsHelp({
  activePhase,
}: BoardShortcutsHelpProps): React.JSX.Element {
  return (
    <div className="board-shortcuts-help">
      <p>
        <strong>Keyboard:</strong> <kbd>R</kbd> refresh runtime, <kbd>Ctrl</kbd>
        +<kbd>Left/Right</kbd> change active phase ({activePhase}),{" "}
        <kbd>Alt</kbd>+<kbd>Left/Right</kbd> move selected task between phases.
      </p>
    </div>
  );
}
