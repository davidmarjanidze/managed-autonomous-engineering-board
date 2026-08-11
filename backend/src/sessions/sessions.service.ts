import Anthropic from "@anthropic-ai/sdk";
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { Observable, Subject } from "rxjs";

import {
  type AgentRegistrationMetadata,
  type ManagedAgentRole,
  getAgentRegistrationMetadata,
} from "@src/agents/agent-registration-options";
import { AgentsCoordinatorService } from "@src/agents/coordinator";
import { RagService } from "@src/rag/rag.service";
import { runTurnWithBudget } from "@src/sessions/budget-runner";
import { TasksService } from "@src/tasks/tasks.service";

export type AgentRole = ManagedAgentRole;

interface ManagedSessionInput {
  taskId: string;
  role: AgentRole;
  taskTitle: string;
  taskDescription?: string;
  screenshotBase64?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  githubPrUrl?: string;
  githubPrId?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
}

type SessionEvent = Record<string, unknown>;

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
  registration: AgentRegistrationMetadata;
  runtimeMode: "managed" | "simulated";
  reasons: string[];
}

@Injectable()
export class SessionsService implements OnApplicationShutdown {
  private readonly logger = new Logger(SessionsService.name);
  private readonly anthropic: Anthropic | null;
  private readonly streams = new Map<string, Subject<SessionEvent>>();
  private readonly taskSessions = new Map<string, string>();
  private readonly eventHistory = new Map<string, SessionEvent[]>();
  private readonly stoppedSessionIds = new Set<string>();
  private readonly sessionLogFiles = new Map<string, string>();
  // Track remote Anthropic session IDs so we can terminate them on shutdown
  private readonly remoteSessionIds = new Map<string, string>();

  constructor(
    private readonly agentsCoordinator: AgentsCoordinatorService,
    private readonly ragService: RagService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.anthropic = apiKey
      ? new Anthropic({
          apiKey,
          defaultHeaders: {
            "anthropic-beta":
              process.env.ANTHROPIC_BETA_HEADER ?? "managed-agents-2026-04-01",
          },
        })
      : null;
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.anthropic || this.remoteSessionIds.size === 0) {
      return;
    }

    this.logger.log(
      `Terminating ${this.remoteSessionIds.size} active managed session(s) on shutdown...`,
    );
    await Promise.all(
      [...this.remoteSessionIds.values()].map((remoteId) =>
        this.anthropic!.beta.sessions.delete(remoteId).catch((e) =>
          this.logger.warn(
            `Failed to terminate session ${remoteId}: ${String(e)}`,
          ),
        ),
      ),
    );
    this.remoteSessionIds.clear();
    this.logger.log("All managed sessions terminated.");
  }

  async terminateRemoteSession(localSessionId: string): Promise<boolean> {
    const remoteId = this.remoteSessionIds.get(localSessionId);
    if (!remoteId || !this.anthropic) {
      return false;
    }

    try {
      await this.anthropic.beta.sessions.delete(remoteId);
      this.remoteSessionIds.delete(localSessionId);
      this.logger.log(`Terminated remote session ${remoteId}`);
      return true;
    } catch (e) {
      const message = String(e);
      if (/Cannot delete session while it is running/i.test(message)) {
        this.logger.log(
          `Remote session ${remoteId} is still running; delete deferred until it finishes processing the interrupt.`,
        );
      } else {
        this.logger.warn(`Failed to terminate session ${remoteId}: ${message}`);
      }
      return false;
    }
  }

  async interruptRemoteSession(localSessionId: string): Promise<boolean> {
    const remoteId = this.remoteSessionIds.get(localSessionId);
    if (!remoteId || !this.anthropic) {
      return false;
    }

    try {
      await this.anthropic.beta.sessions.events.send(remoteId, {
        events: [{ type: "user.interrupt" } as any],
      });
      this.logger.log(`Sent interrupt to remote session ${remoteId}`);
      return true;
    } catch (e) {
      this.logger.warn(`Failed to interrupt session ${remoteId}: ${String(e)}`);
      return false;
    }
  }

  getActiveRemoteSessions(): Array<{ localId: string; remoteId: string }> {
    return [...this.remoteSessionIds.entries()].map(([localId, remoteId]) => ({
      localId,
      remoteId,
    }));
  }

  createSession(sessionId: string): void {
    if (!this.streams.has(sessionId)) {
      this.streams.set(sessionId, new Subject<SessionEvent>());
    }

    if (!this.eventHistory.has(sessionId)) {
      this.eventHistory.set(sessionId, []);
    }
  }

  getRuntimeHealth(): RuntimeHealth {
    const betaHeader =
      process.env.ANTHROPIC_BETA_HEADER ?? "managed-agents-2026-04-01";
    const apiKeyConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
    const agents = this.agentsCoordinator.getAgentStatus();
    const capabilities = {
      managedSessionsCreate: Boolean(this.anthropic?.beta?.sessions?.create),
      managedSessionsStream: Boolean(
        this.anthropic?.beta?.sessions?.events?.stream,
      ),
    };
    const registration = getAgentRegistrationMetadata();

    const reasons: string[] = [];
    if (!apiKeyConfigured) {
      reasons.push("ANTHROPIC_API_KEY is not configured.");
    }
    if (!registration.mcpConfigured) {
      reasons.push(
        "GitHub MCP endpoint is not configured. Set GITHUB_MCP_SERVER_URL or GITHUB_MCP_DOMAIN.",
      );
    }
    if (!registration.mcpAuthConfigured) {
      reasons.push(
        "GitHub MCP auth is not confirmed. Set GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_MCP_AUTH_CONFIRMED=true.",
      );
    }
    if (!agents.dev || !agents.reviewer || !agents.tester) {
      reasons.push("One or more managed agent registrations are unavailable.");
    }
    if (
      !capabilities.managedSessionsCreate ||
      !capabilities.managedSessionsStream
    ) {
      reasons.push("Managed sessions SDK capabilities are incomplete.");
    }

    return {
      apiKeyConfigured,
      betaHeader,
      agents,
      capabilities,
      registration,
      runtimeMode: reasons.length === 0 ? "managed" : "simulated",
      reasons,
    };
  }

  publish(sessionId: string, event: SessionEvent): void {
    const stream = this.streams.get(sessionId);
    const history = this.eventHistory.get(sessionId);
    history?.push(event);

    void this.writeSessionLog(sessionId, event);

    const rawOutputText = this.extractUiRawOutputText(event);
    if (rawOutputText) {
      const taskId =
        typeof event.taskId === "string" && event.taskId.trim().length > 0
          ? event.taskId
          : "unknown";
      const type =
        typeof event.type === "string" && event.type.trim().length > 0
          ? event.type
          : "managed_event";
      this.logger.log(
        `ui raw output sessionId=${sessionId} taskId=${taskId} type=${type}\n${rawOutputText}`,
      );
    }

    stream?.next(event);
  }

  getStream(sessionId: string): Observable<SessionEvent> {
    this.createSession(sessionId);
    const history = this.eventHistory.get(sessionId) ?? [];
    const stream = this.streams.get(sessionId)!;

    return new Observable<SessionEvent>((subscriber: any) => {
      for (const event of history) {
        subscriber.next(event);
      }

      const subscription = stream.subscribe((event: any) => {
        subscriber.next(event);
      });

      return () => subscription.unsubscribe();
    });
  }

  createManagedSession(input: ManagedSessionInput): string {
    const sessionId = randomUUID();
    this.taskSessions.set(input.taskId, sessionId);
    this.createSession(sessionId);
    this.sessionLogFiles.set(
      sessionId,
      this.buildSessionLogFilePath(sessionId, input),
    );

    this.publish(sessionId, {
      type: "session_started",
      role: input.role,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      worktreePath: input.worktreePath,
      worktreeBranch: input.worktreeBranch,
      at: new Date().toISOString(),
    });

    const inputBlocks = this.buildInitialInputBlocks(input);
    this.publish(sessionId, {
      type: "session_input_prepared",
      role: input.role,
      taskId: input.taskId,
      blocks: inputBlocks,
      at: new Date().toISOString(),
    });

    void this.runManagedSession(sessionId, input, inputBlocks);
    return sessionId;
  }

  async stopTaskSession(
    taskId: string,
  ): Promise<{ stopped: boolean; reason?: string; sessionId?: string }> {
    const sessionId =
      this.taskSessions.get(taskId) ?? this.tasksService.get(taskId)?.sessionId;
    if (!sessionId) {
      return {
        stopped: false,
        reason: "No active session found for this task.",
      };
    }

    this.stoppedSessionIds.add(sessionId);
    const interrupted = await this.interruptRemoteSession(sessionId);
    const terminated = await this.terminateRemoteSession(sessionId);

    this.publish(sessionId, {
      type: "session_stop_requested",
      taskId,
      sessionId,
      interrupted,
      terminated,
      at: new Date().toISOString(),
    });

    this.tasksService.updateAgentState(taskId, {
      agentStatus: "failed",
      agentMessage: "Stopped by user.",
      sessionId,
    });

    return {
      stopped: true,
      sessionId,
      reason:
        interrupted || terminated
          ? undefined
          : "Unable to interrupt or terminate remote session.",
    };
  }

  getSessionByTask(taskId: string): string | undefined {
    return this.taskSessions.get(taskId);
  }

  private async runManagedSession(
    sessionId: string,
    input: ManagedSessionInput,
    inputBlocks: SessionEvent[],
  ): Promise<void> {
    const agentId = this.agentsCoordinator.getAgentId(input.role);
    const environmentId = this.agentsCoordinator.getEnvironmentId();

    if (!this.anthropic || !agentId || !environmentId) {
      this.publish(sessionId, {
        type: "runtime_mode",
        mode: "simulated",
        reason: !this.anthropic
          ? "Anthropic API key is not configured."
          : !agentId
            ? `Agent id for role ${input.role} is unavailable.`
            : "Managed environment is unavailable.",
        at: new Date().toISOString(),
      });
      void this.simulateManagedAgentRun(sessionId, input);
      return;
    }

    this.publish(sessionId, {
      type: "runtime_mode",
      mode: "managed",
      at: new Date().toISOString(),
    });

    const registration = getAgentRegistrationMetadata();

    if (input.role === "dev" && !registration.mcpConfigured) {
      const message =
        "GitHub MCP is not configured. Developer agent cannot clone, branch, push, or create a PR.";
      this.publish(sessionId, {
        type: "managed_session_error",
        role: input.role,
        taskId: input.taskId,
        message,
        at: new Date().toISOString(),
      });
      this.tasksService.updateAgentState(input.taskId, {
        agentRole: input.role,
        agentStatus: "failed",
        agentMessage: message,
        sessionId,
      });
      return;
    }

    if (input.role === "dev" && !registration.mcpAuthConfigured) {
      const message =
        "GitHub MCP authentication is not confirmed. Set GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_MCP_AUTH_CONFIRMED=true before running developer tasks.";
      this.publish(sessionId, {
        type: "managed_session_error",
        role: input.role,
        taskId: input.taskId,
        message,
        at: new Date().toISOString(),
      });
      this.tasksService.updateAgentState(input.taskId, {
        agentRole: input.role,
        agentStatus: "failed",
        agentMessage: message,
        sessionId,
      });
      return;
    }

    if (input.role === "tester" && !registration.mcpConfigured) {
      const message =
        "GitHub MCP is not configured. Tester agent cannot reliably push test updates or merge PRs.";
      this.publish(sessionId, {
        type: "managed_session_error",
        role: input.role,
        taskId: input.taskId,
        message,
        at: new Date().toISOString(),
      });
      this.tasksService.updateAgentState(input.taskId, {
        agentRole: input.role,
        agentStatus: "failed",
        agentMessage: message,
        sessionId,
      });
      return;
    }

    if (input.role === "tester" && !registration.mcpAuthConfigured) {
      const message =
        "GitHub MCP authentication is not confirmed. Tester agent cannot reliably push test updates or merge PRs. Set GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_MCP_AUTH_CONFIRMED=true.";
      this.publish(sessionId, {
        type: "managed_session_error",
        role: input.role,
        taskId: input.taskId,
        message,
        at: new Date().toISOString(),
      });
      this.tasksService.updateAgentState(input.taskId, {
        agentRole: input.role,
        agentStatus: "failed",
        agentMessage: message,
        sessionId,
      });
      return;
    }

    try {
      const initialEvents = this.buildInitialManagedEvents(input);

      const remoteSession = await this.anthropic.beta.sessions.create({
        agent: agentId,
        environment_id: environmentId,
        initial_events: initialEvents,
        title: `${input.taskId}: ${input.taskTitle}`.slice(0, 200),
      });

      this.remoteSessionIds.set(sessionId, remoteSession.id);

      this.publish(sessionId, {
        type: "managed_session_created",
        remoteSessionId: remoteSession.id,
        at: new Date().toISOString(),
      });

      // Skip event_deltas — they double streaming costs without adding information
      const stream = await this.anthropic.beta.sessions.events.stream(
        remoteSession.id,
      );
      await this.executeManagedTurn({
        sessionId,
        remoteSessionId: remoteSession.id,
        input,
        stream,
      });

      if (this.stoppedSessionIds.delete(sessionId)) {
        this.remoteSessionIds.delete(sessionId);
        return;
      }

      if (input.role === "dev") {
        let latestTask = this.tasksService.get(input.taskId);
        if (!latestTask?.githubPrUrl) {
          const maxFollowUpAttempts = 2;
          for (let attempt = 1; attempt <= maxFollowUpAttempts; attempt += 1) {
            this.publish(sessionId, {
              type: "managed_session_retry",
              role: input.role,
              taskId: input.taskId,
              attempt,
              message:
                attempt === 1
                  ? "No PR URL detected yet. Starting MCP-only follow-up session to create the pull request."
                  : "PR URL is still missing. Retrying PR creation with stricter MCP-only instructions.",
              at: new Date().toISOString(),
            });

            const followUpSession = await this.anthropic.beta.sessions.create({
              agent: agentId,
              environment_id: environmentId,
              initial_events: this.buildPrFollowUpEvents(input, attempt),
              title: `${input.taskId}: create PR follow-up ${attempt}`.slice(
                0,
                200,
              ),
            });
            this.remoteSessionIds.set(sessionId, followUpSession.id);
            this.publish(sessionId, {
              type: "managed_session_created",
              remoteSessionId: followUpSession.id,
              at: new Date().toISOString(),
            });

            const followUpStream =
              await this.anthropic.beta.sessions.events.stream(
                followUpSession.id,
              );
            await this.executeManagedTurn({
              sessionId,
              remoteSessionId: followUpSession.id,
              input,
              stream: followUpStream,
            });

            latestTask = this.tasksService.get(input.taskId);
            if (latestTask?.githubPrUrl) {
              break;
            }
          }
        }

        if (!latestTask?.githubPrUrl) {
          const message = this.buildNoPrCompletionMessage(sessionId);
          this.publish(sessionId, {
            type: "managed_session_error",
            role: input.role,
            taskId: input.taskId,
            message,
            at: new Date().toISOString(),
          });
          this.tasksService.updateAgentState(input.taskId, {
            agentRole: input.role,
            agentStatus: "failed",
            agentMessage: message,
            sessionId,
          });
          this.remoteSessionIds.delete(sessionId);
          return;
        }
      }

      if (input.role === "tester") {
        const currentTask = this.tasksService.get(input.taskId);
        const fromPhase = currentTask?.phase ?? "testing";
        const moved = this.tasksService.move(input.taskId, "done");
        if (moved) {
          this.publish(sessionId, {
            type: "task_auto_moved",
            taskId: input.taskId,
            fromPhase,
            toPhase: "done",
            at: new Date().toISOString(),
          });
        }
      }

      this.remoteSessionIds.delete(sessionId);
      this.publish(sessionId, {
        type: "session_completed",
        role: input.role,
        taskId: input.taskId,
        at: new Date().toISOString(),
      });
      this.tasksService.updateAgentState(input.taskId, {
        agentRole: input.role,
        agentStatus: "done",
        agentMessage: undefined,
        sessionId,
      });
    } catch (error) {
      this.remoteSessionIds.delete(sessionId);
      this.publish(sessionId, {
        type: "managed_session_error",
        message: String(error),
        at: new Date().toISOString(),
      });
      this.tasksService.updateAgentState(input.taskId, {
        agentRole: input.role,
        agentStatus: "failed",
        agentMessage: String(error),
        sessionId,
      });
    }
  }

  private buildInitialManagedEvents(input: ManagedSessionInput): Array<{
    type: "user.message";
    content: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: "image/jpeg"; data: string };
        }
    >;
  }> {
    const repoUrl =
      input.githubRepoOwner && input.githubRepoName
        ? `https://github.com/${input.githubRepoOwner}/${input.githubRepoName}`
        : undefined;
    const ticketBranch = `feature/ticket-${input.taskId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")}`;

    const roleInstructions =
      input.role === "dev"
        ? [
            "Mode: implementation.",
            "Implement the task with minimal scope, run relevant tests, then commit and push.",
            "Before doing any work, ensure the repository is present in /workspace/repo. If it already exists, delete it and clone it fresh from GitHub. If it is missing, clone it fresh into /workspace/repo.",
            "Use GitHub MCP for GitHub-facing workflow operations: repository lookup, branch creation, pushing file updates, and pull request creation.",
            "If MCP clone/commit tools are not available in the current tool list, use shell git only for local clone/commit preparation and continue using MCP for branch, push, and PR operations.",
            "Do not run raw shell push commands like git push origin HEAD for remote operations; use GitHub MCP actions for branch, commit, push, and PR.",
            "If validation fails after a meaningful code change, do not stop. Push the current change set to the ticket branch and open a draft PR that includes the failing command and failure summary.",
            `Ticket ID for this task: ${input.taskId}`,
            `Create or update this branch for the ticket using GitHub MCP: ${ticketBranch}`,
            "After pushing, create a Pull Request and print the PR URL.",
            `Use commit message: feat: ${input.taskTitle}`,
          ]
        : input.role === "reviewer"
          ? [
              "Mode: code review only.",
              "Do not modify files, do not commit, do not push, and do not open a new PR.",
              input.githubPrUrl
                ? `Review this existing PR URL only: ${input.githubPrUrl}`
                : "No existing PR URL is available. Report that review cannot proceed until a PR URL is provided.",
              input.githubPrId ? `PR number: ${input.githubPrId}` : "",
              "Post a final review summary comment directly on the existing PR using GitHub MCP.",
              "Provide findings ordered by severity with exact evidence and recommended fixes.",
            ]
          : [
              "Mode: QA verification.",
              "Run relevant validation commands and report failures with reproducible steps.",
              "Use GitHub MCP for push and merge operations on the existing PR branch. You MUST NOT fall back to raw shell git push or shell-based merge commands for remote operations because they can block on interactive auth or hang indefinitely.",
              "If tests are missing, add/commit/push test coverage to the current PR branch before final verification. If MCP clone/commit tools are unavailable, use shell git only for local clone/commit preparation and keep push/merge on GitHub MCP.",
              "If required GitHub MCP capabilities are unavailable, stop and report the blocker with the exact failing tool or command instead of looping.",
              "When checks are green, merge the existing PR via GitHub MCP and report merge confirmation.",
              input.githubPrUrl
                ? `Validate changes from PR: ${input.githubPrUrl}`
                : "",
            ];

    const content: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: "image/jpeg"; data: string };
        }
    > = [
      {
        type: "text" as const,
        text: [
          `Task ID: ${input.taskId}`,
          `Task: ${input.taskTitle}`,
          input.taskDescription ? `Description: ${input.taskDescription}` : "",
          "Use /workspace/repo as your working directory in the remote environment.",
          input.worktreeBranch ? `Branch: ${input.worktreeBranch}` : "",
          repoUrl ? `GitHub repo: ${repoUrl}` : "",
          input.githubPrUrl ? `Existing PR URL: ${input.githubPrUrl}` : "",
          input.githubPrId ? `Existing PR ID: ${input.githubPrId}` : "",
          roleInstructions.filter(Boolean).join("\n"),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];

    if (input.screenshotBase64) {
      const base64Data = input.screenshotBase64.includes(",")
        ? input.screenshotBase64.split(",")[1]
        : input.screenshotBase64;
      content.push({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/jpeg" as const,
          data: base64Data ?? "",
        },
      });
    }

    return [{ type: "user.message" as const, content }];
  }

  private buildPrFollowUpEvents(
    input: ManagedSessionInput,
    attempt: number,
  ): Array<{
    type: "user.message";
    content: Array<{ type: "text"; text: string }>;
  }> {
    const ticketBranch = `feature/ticket-${input.taskId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")}`;
    const repoUrl =
      input.githubRepoOwner && input.githubRepoName
        ? `https://github.com/${input.githubRepoOwner}/${input.githubRepoName}`
        : "";

    return [
      {
        type: "user.message",
        content: [
          {
            type: "text",
            text: [
              `Task ID: ${input.taskId}`,
              repoUrl ? `GitHub repo: ${repoUrl}` : "",
              `Target branch: ${ticketBranch}`,
              "A PR URL has not been detected yet.",
              "Use MCP tools only for this follow-up. Do not run shell commands.",
              "If the branch has not been created or updated yet, create the branch and push the relevant changed files before creating the PR.",
              "First run list_branches and identify the ticket branch.",
              `Prefer ${ticketBranch}; if it is missing, use the branch created for task ${input.taskId}.`,
              "Then run create_pull_request against base branch main. If checks failed earlier, create the PR as draft and mention the failing validation command in the PR body.",
              "If PR already exists, run search_pull_requests and return that PR URL.",
              "Return only the resulting PR URL.",
              attempt > 1
                ? "This is a retry attempt. Focus only on creating or retrieving the PR URL."
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ];
  }

  shouldStopTesterForShellRemoteOperation(
    input: Pick<ManagedSessionInput, "role" | "taskId">,
    event: Record<string, unknown>,
  ): boolean {
    if (input.role !== "tester") {
      return false;
    }

    const type = String(event.type ?? "").toLowerCase();
    const toolName = String(event.tool ?? event.name ?? "").toLowerCase();
    const text = String(
      event.text ?? event.message ?? event.content ?? event.output ?? "",
    );
    const normalizedText = text.toLowerCase();

    const isShellRemoteAction =
      (type.includes("tool_use") || type.includes("tool_result")) &&
      (toolName === "bash" || toolName.includes("shell")) &&
      /\b(git\s+push|git\s+merge|git\s+checkout|git\s+commit|gh\s+pr|gh\s+repo|curl\s+-x\s+post|curl\s+.*github)/i.test(
        normalizedText,
      );

    return isShellRemoteAction;
  }

  private normalizeManagedEvent(
    rawEvent: unknown,
    input: ManagedSessionInput,
  ): SessionEvent {
    // Serialize to plain object so class instances and getters are flattened
    const event = JSON.parse(JSON.stringify(rawEvent ?? {})) as Record<
      string,
      unknown
    >;
    const type = typeof event.type === "string" ? event.type : "managed_event";

    // Log to reveal actual event structure from the Anthropic SDK
    this.logger.log(
      `managed event type=${type} keys=[${Object.keys(event).join(",")}]`,
    );

    let text: string | undefined;
    let tool: string | undefined;
    let role: string | undefined;

    // Extract thinking text from agent.thinking events
    if (typeof event.thinking === "string") {
      text = event.thinking;
    }

    // Extract role
    if (typeof event.role === "string") {
      role = event.role;
    }

    // Extract text from agent.message content blocks
    if (Array.isArray(event.content)) {
      const textParts = (event.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (textParts.length > 0) {
        text = textParts.join("\n");
      }
    }

    // Extract tool name from agent.tool_use / agent.mcp_tool_use
    const toolUse =
      (event.tool_use as Record<string, unknown> | undefined) ??
      (event.mcp_tool_use as Record<string, unknown> | undefined);
    if (typeof toolUse?.name === "string") {
      tool = toolUse.name;
      const inputStr =
        toolUse.input !== undefined
          ? JSON.stringify(toolUse.input).slice(0, 200)
          : "";
      text = inputStr ? `${tool}(${inputStr})` : tool;

      if (/github|pull|branch|commit|push/i.test(tool)) {
        this.logger.log(
          `observed MCP GitHub tool call for ${input.taskId}: ${tool}`,
        );
      }
    }

    // Handle incremental event_delta frames (streamed thinking/text deltas)
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta) {
      if (typeof delta.thinking === "string") {
        text = delta.thinking;
      } else if (typeof delta.text === "string") {
        text = delta.text;
      }
    }

    // Expose error messages
    if (typeof event.message === "string" && !text) {
      text = event.message;
    }

    const normalized: SessionEvent = {
      ...event, // keep all raw fields so client can access them
      type,
      text,
      tool,
      role,
      source: "anthropic-managed-session",
      at: new Date().toISOString(),
    };

    this.capturePullRequestReference(input, normalized);

    return normalized;
  }

  private extractUiRawOutputText(
    event: Record<string, unknown>,
  ): string | null {
    const type = String(event.type ?? "");

    if (type === "agent.thinking" || type === "thinking_delta") {
      const text = String(event.thinking ?? event.text ?? "").trim();
      return text || null;
    }

    if (type === "event_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      const text = String(
        delta?.thinking ?? delta?.text ?? event.text ?? "",
      ).trim();
      return text || null;
    }

    if (type === "agent.message" && Array.isArray(event.content)) {
      const text = (event.content as Array<Record<string, unknown>>)
        .filter((block) => block.type === "text")
        .map((block) => String(block.text ?? "").trim())
        .filter(Boolean)
        .join("\n");
      return text || null;
    }

    if (typeof event.text === "string") {
      const text = event.text.trim();
      if (text && !String(event.tool ?? "").trim()) {
        return text;
      }
    }

    return null;
  }

  private buildSessionLogFilePath(
    sessionId: string,
    input: ManagedSessionInput,
  ): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const taskId = input.taskId.replace(/[^a-z0-9-]/gi, "-");
    const role = input.role.replace(/[^a-z0-9-]/gi, "-");

    return path.join(
      process.cwd(),
      "logs",
      `${timestamp}__${taskId}__${role}__${sessionId}.log`,
    );
  }

  private async writeSessionLog(
    sessionId: string,
    event: SessionEvent,
  ): Promise<void> {
    const filePath = this.sessionLogFiles.get(sessionId);
    if (!filePath) {
      return;
    }

    const rawOutputText = this.extractUiRawOutputText(event);
    const type =
      typeof event.type === "string" && event.type.trim().length > 0
        ? event.type
        : "managed_event";
    const at =
      typeof event.at === "string" && event.at.trim().length > 0
        ? event.at
        : new Date().toISOString();

    const lines = [
      `[${at}] type=${type}`,
      rawOutputText ? `raw:\n${rawOutputText}` : "raw: <none>",
      `event=${JSON.stringify(event)}`,
      "",
    ];

    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, `${lines.join("\n")}\n`, "utf8");
    } catch (error) {
      this.logger.warn(
        `Failed to write session log for ${sessionId}: ${String(error)}`,
      );
    }
  }

  private capturePullRequestReference(
    input: ManagedSessionInput,
    event: SessionEvent,
  ): void {
    const githubBase =
      input.githubRepoOwner && input.githubRepoName
        ? `https://github.com/${input.githubRepoOwner}/${input.githubRepoName}`
        : undefined;
    if (!githubBase) {
      return;
    }

    const candidates = [
      typeof event.text === "string" ? event.text : "",
      typeof event.message === "string" ? event.message : "",
      typeof event.output === "string" ? event.output : "",
      JSON.stringify(event),
    ].filter((value) => value.trim().length > 0);

    for (const candidate of candidates) {
      const urlMatch = candidate.match(
        /https:\/\/(?:api\.)?github\.com\/repos\/[^/]+\/[^/]+\/pulls?\/(\d+)|https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i,
      );
      const number = urlMatch?.[1] ?? urlMatch?.[2];
      if (number) {
        this.tasksService.updateAgentState(input.taskId, {
          githubPrId: number,
          githubPrUrl: `${githubBase}/pull/${number}`,
        });
        return;
      }

      const prMatch = candidate.match(/\bPR\s*#?(\d+)\b/i);
      if (prMatch?.[1]) {
        this.tasksService.updateAgentState(input.taskId, {
          githubPrId: prMatch[1],
          githubPrUrl: `${githubBase}/pull/${prMatch[1]}`,
        });
        return;
      }
    }
  }

  private buildNoPrCompletionMessage(sessionId: string): string {
    const history = this.eventHistory.get(sessionId) ?? [];
    const recent = [...history].reverse();

    const lastToolEvent = recent.find((event) =>
      Boolean(this.extractToolNameFromEvent(event)),
    );
    const lastTool = lastToolEvent
      ? this.extractToolNameFromEvent(lastToolEvent)
      : undefined;

    const lastIssueEvent = recent.find((event) =>
      this.eventLooksLikeFailure(event, this.eventTextForDiagnostics(event)),
    );
    const issueText = lastIssueEvent
      ? this.eventTextForDiagnostics(lastIssueEvent)
      : "";

    const pushLikeStepObserved = recent.some((event) => {
      const tool = this.extractToolNameFromEvent(event);
      return Boolean(
        tool &&
        /(create_branch|push_files|create_or_update_file|create_pull_request)/i.test(
          tool,
        ),
      );
    });

    const toolHint = lastTool ? ` Last MCP tool: ${lastTool}.` : "";

    if (issueText) {
      return `Developer session finished without a PR URL.${toolHint} Last reported issue: ${issueText.slice(0, 260)}`;
    }

    if (pushLikeStepObserved) {
      return `Developer session finished without a PR URL after MCP repository update steps.${toolHint} The run likely stopped before create_pull_request.`;
    }

    return `Developer session finished without a PR URL.${toolHint} Push/PR may not have completed.`;
  }

  private extractToolNameFromEvent(event: SessionEvent): string | undefined {
    if (typeof event.tool === "string" && event.tool.trim().length > 0) {
      return event.tool;
    }

    const toolUse =
      (event.tool_use as Record<string, unknown> | undefined) ??
      (event.mcp_tool_use as Record<string, unknown> | undefined);
    if (typeof toolUse?.name === "string" && toolUse.name.trim().length > 0) {
      return toolUse.name;
    }

    return undefined;
  }

  private eventTextForDiagnostics(event: SessionEvent): string {
    const pieces: string[] = [];
    const push = (value: unknown): void => {
      if (typeof value === "string" && value.trim().length > 0) {
        pieces.push(value.trim());
      }
    };

    push(event.text);
    push(event.message);
    push(event.error);
    push(event.output);
    push(event.result);

    if (pieces.length > 0) {
      return pieces.join(" | ");
    }

    return JSON.stringify(event).slice(0, 280);
  }

  private eventLooksLikeFailure(event: SessionEvent, text: string): boolean {
    if (event.is_error === true) {
      return true;
    }

    if (typeof event.error === "string" && event.error.trim().length > 0) {
      return true;
    }

    const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
    if (type.includes("error") || type.includes("failed")) {
      return true;
    }

    return /\b(failed|forbidden|denied|unauthorized|timeout|rate\s*limit|conflict|unprocessable|exception)\b/i.test(
      text,
    );
  }

  private async executeManagedTurn(params: {
    sessionId: string;
    remoteSessionId: string;
    input: ManagedSessionInput;
    stream: AsyncIterable<unknown>;
  }): Promise<void> {
    const budget = this.agentsCoordinator.getTokenBudget(params.input.role);
    const policy = {
      maxTokens: budget,
      warningThreshold: budget > 0 ? Math.floor(budget * 0.8) : undefined,
    };

    const agentHandle = {
      openTask: async () => undefined,
      stream: async function* () {
        for await (const event of params.stream) {
          yield event as Record<string, unknown>;
        }
      },
      interrupt: async () => {
        await this.anthropic!.beta.sessions.events.send(
          params.remoteSessionId,
          {
            events: [{ type: "user.interrupt" } as any],
          },
        ).catch((e) =>
          this.logger.warn(`Budget interrupt send failed: ${String(e)}`),
        );
      },
    };

    const timeoutMs = this.getManagedSessionTimeoutMs(params.input.role);
    let timeoutHandle: NodeJS.Timeout | undefined;
    const budgetPromise = runTurnWithBudget(
      agentHandle,
      "managed-session",
      policy,
      {
        onEvent: async (event, spent) => {
          const normalized = this.normalizeManagedEvent(event, params.input);
          const rawEvent = event as unknown as Record<string, unknown>;

          if (
            this.shouldStopTesterForShellRemoteOperation(params.input, rawEvent)
          ) {
            this.publish(params.sessionId, {
              type: "managed_session_error",
              role: params.input.role,
              taskId: params.input.taskId,
              message:
                "Tester attempted a shell-based remote operation. The workflow requires GitHub MCP for push/merge actions; stopping to avoid a hang.",
              at: new Date().toISOString(),
            });
            this.tasksService.updateAgentState(params.input.taskId, {
              agentRole: params.input.role,
              agentStatus: "failed",
              agentMessage:
                "Tester attempted a shell-based remote operation; stopped to avoid hanging.",
              sessionId: params.sessionId,
            });
            await agentHandle.interrupt().catch(() => undefined);
            return;
          }

          const usage = rawEvent.usage as Record<string, unknown> | undefined;
          if (usage) {
            normalized.tokensUsed = spent;
            normalized.tokenBudget = budget;
          }

          this.publish(params.sessionId, normalized);
        },
        onWarning: async (spent) => {
          this.logger.warn(
            `Token budget warning for ${params.input.role}: ${spent}/${budget}`,
          );
          this.publish(params.sessionId, {
            type: "budget_warning",
            role: params.input.role,
            taskId: params.input.taskId,
            tokensUsed: spent,
            tokenBudget: budget,
            at: new Date().toISOString(),
          });
        },
        onInterrupt: async (spent) => {
          this.logger.warn(
            `Token budget exceeded for ${params.input.role} (${spent} > ${budget}). Interrupting session.`,
          );
          this.publish(params.sessionId, {
            type: "budget_exceeded",
            role: params.input.role,
            taskId: params.input.taskId,
            tokensUsed: spent,
            tokenBudget: budget,
            at: new Date().toISOString(),
          });
        },
      },
    );

    const timeoutPromise =
      timeoutMs > 0
        ? new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              void agentHandle
                .interrupt()
                .catch((e) =>
                  this.logger.warn(
                    `Managed session timeout interrupt failed: ${String(e)}`,
                  ),
                );
              reject(
                new Error(
                  `Managed session timed out after ${Math.floor(timeoutMs / 1000)}s.`,
                ),
              );
            }, timeoutMs);
          })
        : undefined;

    try {
      if (timeoutPromise) {
        await Promise.race([budgetPromise, timeoutPromise]);
      } else {
        await budgetPromise;
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async simulateManagedAgentRun(
    sessionId: string,
    input: ManagedSessionInput,
  ): Promise<void> {
    const roleLabel =
      input.role === "dev"
        ? "Developer"
        : input.role === "reviewer"
          ? "Reviewer"
          : "Tester";

    const ragPayload = await this.buildSimulatedRagPayload(input);

    const steps: Array<{ delayMs: number; event: SessionEvent }> = [
      {
        delayMs: 200,
        event: {
          type: "thinking_delta",
          role: input.role,
          text: `${roleLabel} agent is analyzing task scope and acceptance criteria.`,
          at: new Date().toISOString(),
        },
      },
      {
        delayMs: 500,
        event: {
          type: "tool_use",
          role: input.role,
          tool: "rag_docs_search",
          input: {
            query: ragPayload.query,
          },
          output: ragPayload,
          at: new Date().toISOString(),
        },
      },
      {
        delayMs: 700,
        event: {
          type: "thinking_delta",
          role: input.role,
          text: input.screenshotBase64
            ? "Image attachment detected and added to the model input payload."
            : "No image attachment present; proceeding with text-only input.",
          at: new Date().toISOString(),
        },
      },
      {
        delayMs: 900,
        event: {
          type: "thinking_delta",
          role: input.role,
          text: `${roleLabel} agent selected an execution strategy and is preparing actions.`,
          at: new Date().toISOString(),
        },
      },
      {
        delayMs: 1300,
        event: {
          type: "message",
          role: input.role,
          text: `${roleLabel} agent completed this simulation phase for ${input.taskId}.`,
          at: new Date().toISOString(),
        },
      },
      {
        delayMs: 1600,
        event: {
          type: "session_completed",
          role: input.role,
          taskId: input.taskId,
          at: new Date().toISOString(),
        },
      },
    ];

    for (const step of steps) {
      setTimeout(() => {
        if (this.stoppedSessionIds.has(sessionId)) {
          return;
        }
        const normalizedEvent: SessionEvent = {
          ...step.event,
          at: new Date().toISOString(),
        };
        this.publish(sessionId, normalizedEvent);
        if (normalizedEvent["type"] === "session_completed") {
          this.tasksService.updateAgentState(input.taskId, {
            agentRole: input.role,
            agentStatus: "done",
            agentMessage: undefined,
            sessionId,
          });
        }
      }, step.delayMs);
    }
  }

  private async buildSimulatedRagPayload(
    input: ManagedSessionInput,
  ): Promise<SessionEvent> {
    const query = [input.taskTitle, input.taskDescription]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .trim();

    try {
      const response = await this.ragService.search(query, {
        limit: 3,
        snippetChars: 160,
      });

      return {
        query,
        metadata: response.metadata,
        results: response.results.map((result) => ({
          source: result.source,
          title: result.title,
          score: result.score,
          snippet: result.snippet,
        })),
      };
    } catch (error) {
      return {
        query,
        error:
          error instanceof Error
            ? error.message
            : "RAG search failed in simulation mode.",
      };
    }
  }

  private buildInitialInputBlocks(input: ManagedSessionInput): SessionEvent[] {
    const text = [
      `Task ID: ${input.taskId}`,
      `Title: ${input.taskTitle}`,
      input.taskDescription ? `Description: ${input.taskDescription}` : "",
      input.worktreeBranch ? `Worktree Branch: ${input.worktreeBranch}` : "",
      input.worktreePath ? `Worktree Path: ${input.worktreePath}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const blocks: SessionEvent[] = [
      {
        type: "text",
        text,
      },
    ];

    if (input.screenshotBase64) {
      const { mediaType, data } = this.extractImageData(input.screenshotBase64);
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data,
        },
      });
    }

    return blocks;
  }

  private extractImageData(screenshotBase64: string): {
    mediaType: string;
    data: string;
  } {
    const dataUrlMatch = screenshotBase64.match(
      /^data:(image\/[\w.+-]+);base64,(.+)$/,
    );
    if (!dataUrlMatch) {
      return {
        mediaType: "image/png",
        data: screenshotBase64,
      };
    }

    return {
      mediaType: dataUrlMatch[1],
      data: dataUrlMatch[2],
    };
  }

  private getManagedSessionTimeoutMs(role: AgentRole): number {
    const byRole: Record<AgentRole, string | undefined> = {
      dev: process.env.MANAGED_SESSION_TIMEOUT_MS_DEV,
      reviewer: process.env.MANAGED_SESSION_TIMEOUT_MS_REVIEWER,
      tester: process.env.MANAGED_SESSION_TIMEOUT_MS_TESTER,
    };

    const defaultTimeoutByRole: Record<AgentRole, number> = {
      dev: 600_000,
      reviewer: 600_000,
      tester: 600_000,
    };

    const raw = byRole[role] ?? process.env.MANAGED_SESSION_TIMEOUT_MS;
    if (raw !== undefined && raw !== "") {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    return defaultTimeoutByRole[role];
  }
}
