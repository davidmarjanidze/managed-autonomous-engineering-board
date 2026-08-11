interface RuntimeShortcutsHelpProps {
  shortcutStepMs: number;
}

export function RuntimeShortcutsHelp({
  shortcutStepMs,
}: RuntimeShortcutsHelpProps): React.JSX.Element {
  return (
    <div className="runtime-shortcuts-help">
      <p>
        <strong>Keyboard:</strong> <kbd>R</kbd> refresh diagnostics,{" "}
        <kbd>P</kbd> pause/resume polling, <kbd>Ctrl</kbd>+<kbd>Up/Down</kbd>{" "}
        adjust poll interval by {shortcutStepMs} ms.
      </p>
    </div>
  );
}
