import type { RuntimeHealth } from "@src/services/sessions";

interface RuntimeSummaryPanelProps {
  runtimeHealth: RuntimeHealth | null;
  runtimeHealthRefreshing: boolean;
  runtimeHealthUpdatedAt: string | null;
  runtimeSummaryRelativeAge: string | null;
  runtimeSummaryFreshness: "fresh" | "stale" | "unknown";
  runtimeHealthRefreshError: string | null;
  onRefresh: () => void;
}

export function RuntimeSummaryPanel({
  runtimeHealth,
  runtimeHealthRefreshing,
  runtimeHealthUpdatedAt,
  runtimeSummaryRelativeAge,
  runtimeSummaryFreshness,
  runtimeHealthRefreshError,
  onRefresh,
}: RuntimeSummaryPanelProps): React.JSX.Element {
  const liveAnnouncement = runtimeHealthRefreshError
    ? runtimeHealthRefreshError
    : runtimeHealthRefreshing
      ? "Runtime summary refresh in progress."
      : runtimeHealthUpdatedAt
        ? `Runtime summary ${runtimeSummaryFreshness}. Last updated at ${new Date(runtimeHealthUpdatedAt).toLocaleTimeString()}.`
        : "Runtime summary has not been updated yet.";

  return (
    <div className="board-runtime-summary">
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </p>
      <p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={runtimeHealthRefreshing}
        >
          {runtimeHealthRefreshing
            ? "Refreshing runtime..."
            : "Refresh Runtime Summary"}
        </button>
      </p>
      <p>
        Last updated:{" "}
        {runtimeHealthUpdatedAt
          ? new Date(runtimeHealthUpdatedAt).toLocaleTimeString()
          : "never"}
        {runtimeSummaryRelativeAge ? ` (${runtimeSummaryRelativeAge})` : ""}
      </p>
      <p
        className={`board-runtime-freshness board-runtime-freshness-${runtimeSummaryFreshness}`}
      >
        Data status: {runtimeSummaryFreshness}
        {runtimeSummaryFreshness === "stale" ? " (refresh recommended)" : ""}
      </p>
      {runtimeHealthRefreshError ? <p>{runtimeHealthRefreshError}</p> : null}
      {runtimeHealth ? (
        <>
          <p>
            Runtime: <strong>{runtimeHealth.runtimeMode}</strong> | MCP:{" "}
            {runtimeHealth.registration.mcpConfigured
              ? "configured"
              : "not configured"}
          </p>
          <p>
            dev={String(runtimeHealth.agents.dev)} (tools:{" "}
            {runtimeHealth.registration.roles.dev.tools.join(", ") || "none"},
            mcp:{" "}
            {runtimeHealth.registration.roles.dev.mcpServers.join(", ") ||
              "none"}
            )
          </p>
          <p>
            reviewer={String(runtimeHealth.agents.reviewer)} (tools:{" "}
            {runtimeHealth.registration.roles.reviewer.tools.join(", ") ||
              "none"}
            , mcp:{" "}
            {runtimeHealth.registration.roles.reviewer.mcpServers.join(", ") ||
              "none"}
            )
          </p>
          <p>
            tester={String(runtimeHealth.agents.tester)} (tools:{" "}
            {runtimeHealth.registration.roles.tester.tools.join(", ") || "none"}
            , mcp:{" "}
            {runtimeHealth.registration.roles.tester.mcpServers.join(", ") ||
              "none"}
            )
          </p>
        </>
      ) : (
        <p>Runtime summary unavailable.</p>
      )}
    </div>
  );
}
