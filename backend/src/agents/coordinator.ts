import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger, Module, OnModuleInit } from "@nestjs/common";

import { type ManagedAgentRole } from "@src/agents/agent-registration-options";
import { registerDevAgent } from "@src/agents/dev-agent";
import { registerReviewerAgent } from "@src/agents/reviewer-agent";
import { registerTesterAgent } from "@src/agents/tester-agent";

@Injectable()
export class AgentsCoordinatorService implements OnModuleInit {
  private readonly logger = new Logger(AgentsCoordinatorService.name);
  private readonly agentIds: Partial<Record<ManagedAgentRole, string>> = {};
  private environmentId: string | undefined;

  async onModuleInit(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return;
    }

    await this.ensureEnvironment();
    console.log(">><");
    await Promise.all([
      this.ensureAgent(
        "dev",
        process.env.ANTHROPIC_DEV_AGENT_ID,
        registerDevAgent,
      ),
      this.ensureAgent(
        "reviewer",
        process.env.ANTHROPIC_REVIEWER_AGENT_ID,
        registerReviewerAgent,
      ),
      this.ensureAgent(
        "tester",
        process.env.ANTHROPIC_TESTER_AGENT_ID,
        registerTesterAgent,
      ),
    ]);
  }

  private async ensureAgent(
    role: ManagedAgentRole,
    cachedId: string | undefined,
    register: () => Promise<string>,
  ): Promise<void> {
    // Verify a cached agent ID is still active before trusting it
    if (cachedId?.trim()) {
      const active = await this.isAgentActive(cachedId.trim());
      if (active) {
        this.agentIds[role] = cachedId.trim();
        this.logger.log(`${role} agent reused from env: ${cachedId.trim()}`);
        return;
      }
      this.logger.warn(
        `${role} agent ${cachedId.trim()} is archived or missing — creating new one`,
      );
    }

    try {
      const id = await register();
      this.agentIds[role] = id;
      this.logger.log(
        `${role} agent registered: ${id} — add ANTHROPIC_${role.toUpperCase()}_AGENT_ID=${id} to .env to reuse it`,
      );
    } catch (e: unknown) {
      this.logger.error(`${role} agent registration failed: ${String(e)}`);
    }
  }

  private async isAgentActive(agentId: string): Promise<boolean> {
    try {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultHeaders: {
          "anthropic-beta":
            process.env.ANTHROPIC_BETA_HEADER ?? "managed-agents-2026-04-01",
        },
      });
      const agent = await anthropic.beta.agents.retrieve(agentId);
      return agent.archived_at === null;
    } catch {
      return false;
    }
  }

  private async isEnvironmentActive(envId: string): Promise<boolean> {
    try {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultHeaders: {
          "anthropic-beta":
            process.env.ANTHROPIC_BETA_HEADER ?? "managed-agents-2026-04-01",
        },
      });
      await anthropic.beta.environments.retrieve(envId);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureEnvironment(): Promise<void> {
    const cached = process.env.ANTHROPIC_ENVIRONMENT_ID?.trim();
    if (cached && (await this.isEnvironmentActive(cached))) {
      this.environmentId = cached;
      this.logger.log(`Managed environment reused from env: ${cached}`);
      return;
    }
    if (cached) {
      this.logger.warn(
        `Cached environment ${cached} not found — creating a new one`,
      );
    }

    try {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultHeaders: {
          "anthropic-beta":
            process.env.ANTHROPIC_BETA_HEADER ?? "managed-agents-2026-04-01",
        },
      });

      const env = await anthropic.beta.environments.create({
        name: "managed-board-env",
        description:
          "Managed Autonomous Engineering Board execution environment",
        config: { type: "cloud" },
      });

      this.environmentId = env.id;
      this.logger.log(
        `Created managed environment: ${env.id} — add ANTHROPIC_ENVIRONMENT_ID=${env.id} to .env to reuse it`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not create managed environment: ${String(error)}`,
      );
    }
  }

  getAgentId(role: ManagedAgentRole): string | undefined {
    return this.agentIds[role];
  }

  getEnvironmentId(): string | undefined {
    return this.environmentId;
  }

  getAgentStatus(): Record<ManagedAgentRole, boolean> {
    return {
      dev: Boolean(this.agentIds.dev),
      reviewer: Boolean(this.agentIds.reviewer),
      tester: Boolean(this.agentIds.tester),
    };
  }

  /** Per-role token budgets; 0 means unlimited. */
  getTokenBudget(role: ManagedAgentRole): number {
    const envMap: Record<ManagedAgentRole, string> = {
      dev: process.env.TOKEN_BUDGET_DEV ?? "8000",
      reviewer: process.env.TOKEN_BUDGET_REVIEWER ?? "5000",
      tester: process.env.TOKEN_BUDGET_TESTER ?? "4000",
    };
    const parsed = parseInt(envMap[role], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
}

@Module({
  providers: [AgentsCoordinatorService],
  exports: [AgentsCoordinatorService],
})
export class AgentsModule {}
