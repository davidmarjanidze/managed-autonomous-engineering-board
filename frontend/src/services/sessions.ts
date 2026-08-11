import { API_BASE_URL } from "@src/config";

export interface RuntimeHealth {
  apiKeyConfigured: boolean;
  betaHeader: string;
  agents: {
    dev: boolean;
    reviewer: boolean;
    tester: boolean;
  };
  capabilities: {
    managedSessionsCreate: boolean;
    managedSessionsStream: boolean;
  };
  registration: {
    mcpConfigured: boolean;
    mcpAuthConfigured?: boolean;
    mcpAuthSource?: "none" | "env_pat" | "explicit_confirmation";
    mcpServers?: Array<{
      type: "url";
      name: string;
      url: string;
    }>;
    mcpToolsets?: Array<{ type: "mcp_toolset"; mcp_server_name: string }>;
    roles: {
      dev: {
        tools: string[];
        mcpServers: string[];
      };
      reviewer: {
        tools: string[];
        mcpServers: string[];
      };
      tester: {
        tools: string[];
        mcpServers: string[];
      };
    };
  };
  runtimeMode: "managed" | "simulated";
  reasons: string[];
}

export async function getRuntimeHealth(): Promise<RuntimeHealth> {
  const response = await fetch(`${API_BASE_URL}/sessions/runtime-health`);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as RuntimeHealth;
}
