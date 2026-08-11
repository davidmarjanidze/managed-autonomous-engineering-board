import { describe, expect, it } from "@jest/globals";

import { buildAgentTools } from "@src/agents/agent-registration-options";

describe("buildAgentTools", () => {
  it("configures all toolsets with always_allow permission policy", () => {
    const tools = buildAgentTools([
      { type: "mcp_toolset" as const, mcp_server_name: "github" },
    ]);

    expect(tools).toEqual([
      {
        type: "agent_toolset_20260401",
        default_config: {
          enabled: true,
          permission_policy: { type: "always_allow" },
        },
      },
      {
        type: "mcp_toolset",
        mcp_server_name: "github",
        default_config: {
          enabled: true,
          permission_policy: { type: "always_allow" },
        },
      },
    ]);
  });
});
