import type { RuntimeHealth } from "@src/services/sessions";

interface RuntimeHealthSummaryProps {
  health: RuntimeHealth | null;
}

export function RuntimeHealthSummary({
  health,
}: RuntimeHealthSummaryProps): React.JSX.Element | null {
  if (!health) {
    return null;
  }

  return (
    <>
      <p>
        Runtime Mode: <strong>{health.runtimeMode}</strong>
      </p>
      <p>Beta Header: {health.betaHeader}</p>
      <p>API Key Configured: {health.apiKeyConfigured ? "yes" : "no"}</p>
      <p>
        Agent Registration: dev={String(health.agents.dev)}, reviewer=
        {String(health.agents.reviewer)}, tester={String(health.agents.tester)}
      </p>
      <p>
        Managed Capabilities: create=
        {String(health.capabilities.managedSessionsCreate)}, stream=
        {String(health.capabilities.managedSessionsStream)}
      </p>
      <p>MCP Configured: {health.registration.mcpConfigured ? "yes" : "no"}</p>
      <p>
        MCP Auth Configured:{" "}
        {health.registration.mcpAuthConfigured ? "yes" : "no"}
        {health.registration.mcpAuthSource
          ? ` (${health.registration.mcpAuthSource})`
          : ""}
      </p>
      <div>
        <p>Agent Registration Capabilities:</p>
        <ul>
          <li>
            dev: tools=
            {health.registration.roles.dev.tools.join(", ") || "none"}, mcp=
            {health.registration.roles.dev.mcpServers.join(", ") || "none"}
          </li>
          <li>
            reviewer: tools=
            {health.registration.roles.reviewer.tools.join(", ") || "none"},
            mcp=
            {health.registration.roles.reviewer.mcpServers.join(", ") || "none"}
          </li>
          <li>
            tester: tools=
            {health.registration.roles.tester.tools.join(", ") || "none"}, mcp=
            {health.registration.roles.tester.mcpServers.join(", ") || "none"}
          </li>
        </ul>
      </div>
      {health.reasons.length > 0 ? (
        <div>
          <p>Fallback Reasons:</p>
          <ul>
            {health.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No fallback reasons. Managed mode is fully ready.</p>
      )}
    </>
  );
}
