interface RuntimeDiagnosticsHeaderProps {
  loading: boolean;
  savingPolicy: boolean;
  onRefresh: () => void;
}

export function RuntimeDiagnosticsHeader({
  loading,
  savingPolicy,
  onRefresh,
}: RuntimeDiagnosticsHeaderProps): React.JSX.Element {
  return (
    <div className="runtime-diagnostics-header">
      <h2>Runtime Diagnostics</h2>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading || savingPolicy}
      >
        {loading ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );
}
