import type {
  BetaManagedAgentsAgentToolset20260401Params,
  BetaManagedAgentsMCPToolsetParams,
} from "@anthropic-ai/sdk/resources/beta/agents";

export type ManagedAgentRole = "dev" | "reviewer" | "tester";

export interface AgentRegistrationRoleMetadata {
  tools: string[];
  mcpServers: string[];
}

export interface AgentRegistrationMetadata {
  mcpConfigured: boolean;
  mcpAuthConfigured: boolean;
  mcpAuthSource: "none" | "env_pat" | "explicit_confirmation";
  mcpServers: Array<{
    type: "url";
    name: string;
    url: string;
  }>;
  mcpToolsets: BetaManagedAgentsMCPToolsetParams[];
  roles: Record<ManagedAgentRole, AgentRegistrationRoleMetadata>;
}

export type AgentToolDefinition =
  | BetaManagedAgentsAgentToolset20260401Params
  | BetaManagedAgentsMCPToolsetParams;

const ALWAYS_ALLOW_POLICY = {
  type: "always_allow" as const,
};

interface McpParams {
  mcpServers: Array<{
    type: "url";
    name: string;
    url: string;
  }>;
  mcpToolsets: BetaManagedAgentsMCPToolsetParams[];
}

function resolveGithubMcpServerUrl(): string | undefined {
  const explicitUrl = process.env.GITHUB_MCP_SERVER_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const mcpDomain = process.env.GITHUB_MCP_DOMAIN?.trim();
  if (!mcpDomain) {
    return undefined;
  }

  const normalizedDomain = /^https?:\/\//i.test(mcpDomain)
    ? mcpDomain
    : `https://${mcpDomain}`;
  const base = normalizedDomain.endsWith("/")
    ? normalizedDomain.slice(0, -1)
    : normalizedDomain;

  return `${base}/mcp/github/`;
}

export function buildMcpParams(): McpParams {
  const url = resolveGithubMcpServerUrl();
  if (!url) {
    return { mcpServers: [], mcpToolsets: [] };
  }

  return {
    mcpServers: [
      {
        type: "url" as const,
        name: "github",
        url,
      },
    ],
    mcpToolsets: [{ type: "mcp_toolset" as const, mcp_server_name: "github" }],
  };
}

export function buildAgentTools(
  mcpToolsets: BetaManagedAgentsMCPToolsetParams[],
): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = [
    {
      type: "agent_toolset_20260401",
      default_config: {
        enabled: true,
        permission_policy: ALWAYS_ALLOW_POLICY,
      },
    } as BetaManagedAgentsAgentToolset20260401Params,
    ...mcpToolsets.map(
      (toolset): BetaManagedAgentsMCPToolsetParams => ({
        ...toolset,
        default_config: {
          enabled: true,
          permission_policy: ALWAYS_ALLOW_POLICY,
        },
      }),
    ),
  ];

  return tools;
}

export function getAgentRegistrationMetadata(): AgentRegistrationMetadata {
  const { mcpServers, mcpToolsets } = buildMcpParams();
  const mcpServerNames = mcpServers.map((s) => s.name);
  const hasPersonalAccessToken = Boolean(
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim(),
  );
  const explicitConfirmation =
    process.env.GITHUB_MCP_AUTH_CONFIRMED?.trim().toLowerCase() === "true";
  const mcpAuthConfigured = hasPersonalAccessToken || explicitConfirmation;
  const mcpAuthSource = explicitConfirmation
    ? "explicit_confirmation"
    : hasPersonalAccessToken
      ? "env_pat"
      : "none";
  const baseToolNames = [
    "agent_toolset_20260401",
    ...mcpToolsets.map((t) => t.mcp_server_name),
  ];

  return {
    mcpConfigured: mcpServers.length > 0,
    mcpAuthConfigured,
    mcpAuthSource,
    mcpServers,
    mcpToolsets,
    roles: {
      dev: { tools: baseToolNames, mcpServers: mcpServerNames },
      reviewer: { tools: baseToolNames, mcpServers: mcpServerNames },
      tester: { tools: baseToolNames, mcpServers: mcpServerNames },
    },
  };
}
