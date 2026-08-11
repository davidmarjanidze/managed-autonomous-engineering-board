import Anthropic from "@anthropic-ai/sdk";

import { TESTER_AGENT_SYSTEM_PROMPT } from "@src/agents/agent-prompts";
import {
  buildAgentTools,
  buildMcpParams,
} from "@src/agents/agent-registration-options";

export async function registerTesterAgent(): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: {
      "anthropic-beta":
        process.env.ANTHROPIC_BETA_HEADER ?? "managed-agents-2026-04-01",
    },
  });

  const modelId =
    process.env.ANTHROPIC_TESTER_AGENT_MODEL ??
    process.env.ANTHROPIC_AGENT_MODEL ??
    "claude-sonnet-4-6";
  const { mcpServers, mcpToolsets } = buildMcpParams();
  const agent = await anthropic.beta.agents.create({
    name: "Tester Agent",
    model: modelId,
    system: TESTER_AGENT_SYSTEM_PROMPT,
    tools: buildAgentTools(mcpToolsets),
    mcp_servers: mcpServers,
  });

  return agent.id;
}
