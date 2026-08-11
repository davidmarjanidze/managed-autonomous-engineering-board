interface RuntimePollingControlsProps {
  pollIntervalMs: number;
  pollPaused: boolean;
  onPollIntervalChange: (value: number) => void;
  onTogglePollPaused: () => void;
}

export function RuntimePollingControls({
  pollIntervalMs,
  pollPaused,
  onPollIntervalChange,
  onTogglePollPaused,
}: RuntimePollingControlsProps): React.JSX.Element {
  return (
    <div className="runtime-controls-row">
      <label>
        Poll Interval (ms)
        <input
          type="number"
          min={1000}
          step={1000}
          value={pollIntervalMs}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onPollIntervalChange(Number(event.target.value))
          }
        />
      </label>
      <button type="button" onClick={onTogglePollPaused}>
        {pollPaused ? "Resume Polling" : "Pause Polling"}
      </button>
    </div>
  );
}
