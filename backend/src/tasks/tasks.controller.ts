import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import {
  SessionsService,
  type AgentRole,
} from "@src/sessions/sessions.service";
import {
  ApprovalGateService,
  type ApprovalRequestPage,
  type ApprovalRetentionAuditEntry,
  type ApprovalRetentionStatus,
  type ApprovalRetentionUpdate,
} from "@src/tasks/approval-gate.service";
import {
  TasksService,
  type Task,
  type TaskPhase,
} from "@src/tasks/tasks.service";

interface UpsertTaskBody {
  id: string;
  title: string;
  description?: string;
  phase: TaskPhase;
  screenshotBase64?: string;
  sessionId?: string;
  agentRole?: AgentRole;
  agentStatus?: "processing" | "failed" | "done";
  agentMessage?: string;
  githubPrUrl?: string;
  githubPrId?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeStatus?: "ready" | "failed";
  worktreeMessage?: string;
}

interface MoveTaskBody {
  phase: TaskPhase;
  approvalToken?: string;
}

interface UpdateApprovalGateBody {
  enabled: boolean;
}

interface EvaluateApprovalBody {
  taskId: string;
  fromPhase: TaskPhase;
  toPhase: TaskPhase;
}

interface ApprovalDecisionBody {
  approved: boolean;
  actor?: string;
  note?: string;
}

interface UpdateApprovalRetentionBody {
  maxHistoryCount?: number;
  maxAgeDays?: number;
  pruneIntervalMs?: number;
  actor?: string;
  source?: string;
}

const TASK_PHASES: TaskPhase[] = [
  "todo",
  "in-progress",
  "in-review",
  "testing",
  "done",
];

const APPROVAL_REQUEST_STATUSES = ["pending", "approved", "rejected"];

@Controller("tasks")
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly sessionsService: SessionsService,
    private readonly approvalGateService: ApprovalGateService,
  ) {}

  @Get("approval-gate")
  getApprovalGate(): { enabled: boolean; protectedPhases: TaskPhase[] } {
    return this.approvalGateService.getStatus();
  }

  @Patch("approval-gate")
  updateApprovalGate(@Body() body: UpdateApprovalGateBody): {
    enabled: boolean;
    protectedPhases: TaskPhase[];
  } {
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("enabled must be a boolean.");
    }

    return this.approvalGateService.setEnabled(body.enabled);
  }

  @Get("approval-gate/requests")
  listApprovalRequests(
    @Query("taskId") taskId?: string,
    @Query("status") status?: "pending" | "approved" | "rejected",
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
  ): ApprovalRequestPage {
    const limit =
      limitRaw === undefined
        ? undefined
        : this.parseQueryInteger(limitRaw, "limit", { min: 1 });
    const offset =
      offsetRaw === undefined
        ? undefined
        : this.parseQueryInteger(offsetRaw, "offset", { min: 0 });

    if (
      status !== undefined &&
      !APPROVAL_REQUEST_STATUSES.includes(status as string)
    ) {
      throw new BadRequestException(
        `status must be one of: ${APPROVAL_REQUEST_STATUSES.join(", ")}.`,
      );
    }

    return this.approvalGateService.listRequestsPage({
      taskId,
      status,
      limit,
      offset,
    });
  }

  @Get("approval-gate/retention")
  getApprovalRetention(): ApprovalRetentionStatus {
    return this.approvalGateService.getRetentionStatus();
  }

  @Get("approval-gate/retention/audit")
  getApprovalRetentionAudit(
    @Query("limit") limitRaw?: string,
  ): ApprovalRetentionAuditEntry[] {
    const limit =
      limitRaw === undefined
        ? undefined
        : this.parseQueryInteger(limitRaw, "limit", { min: 1 });
    return this.approvalGateService.listRetentionAudit(limit);
  }

  @Patch("approval-gate/retention")
  updateApprovalRetention(
    @Body() body: UpdateApprovalRetentionBody,
  ): ApprovalRetentionStatus {
    const update: ApprovalRetentionUpdate = {
      maxHistoryCount: body.maxHistoryCount,
      maxAgeDays: body.maxAgeDays,
      pruneIntervalMs: body.pruneIntervalMs,
    };
    try {
      const validated =
        this.approvalGateService.validateRetentionPolicyUpdate(update);
      return this.approvalGateService.updateRetentionPolicy(validated, {
        actor: body.actor,
        source: body.source,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Invalid approval retention policy update.";
      throw new BadRequestException(message);
    }
  }

  @Post("approval-gate/evaluate")
  evaluateApproval(@Body() body: EvaluateApprovalBody): {
    approvalRequired: boolean;
    requestId?: string;
    reason?: string;
  } {
    if (typeof body?.taskId !== "string" || body.taskId.trim().length === 0) {
      throw new BadRequestException("taskId must be a non-empty string.");
    }
    if (!this.isTaskPhase(body.fromPhase)) {
      throw new BadRequestException(
        `fromPhase must be one of: ${TASK_PHASES.join(", ")}.`,
      );
    }
    if (!this.isTaskPhase(body.toPhase)) {
      throw new BadRequestException(
        `toPhase must be one of: ${TASK_PHASES.join(", ")}.`,
      );
    }

    const result = this.approvalGateService.evaluateTransition(
      body.taskId,
      body.fromPhase,
      body.toPhase,
    );

    return {
      approvalRequired: result.approvalRequired,
      requestId: result.request?.id,
      reason: result.approvalRequired
        ? "Human approval is required for this high-impact transition."
        : undefined,
    };
  }

  @Post("approval-gate/requests/:requestId/decision")
  decideApproval(
    @Param("requestId") requestId: string,
    @Body() body: ApprovalDecisionBody,
  ): { id: string; status: string } {
    if (typeof body?.approved !== "boolean") {
      throw new BadRequestException("approved must be a boolean.");
    }

    const updated = this.approvalGateService.decideRequest(
      requestId,
      body.approved,
      body.actor,
      body.note,
    );
    if (!updated) {
      throw new NotFoundException(
        `Approval request ${requestId} was not found`,
      );
    }

    return {
      id: updated.id,
      status: updated.status,
    };
  }

  @Get()
  list(): Task[] {
    return this.tasksService.list();
  }

  @Post()
  upsert(@Body() body: UpsertTaskBody): Task {
    return this.tasksService.upsert({
      id: body.id,
      title: body.title,
      description: body.description,
      phase: body.phase,
      screenshotBase64: body.screenshotBase64,
      sessionId: body.sessionId,
      agentRole: body.agentRole,
      agentStatus: body.agentStatus,
      agentMessage: body.agentMessage,
      githubPrUrl: body.githubPrUrl,
      githubPrId: body.githubPrId,
      worktreePath: body.worktreePath,
      worktreeBranch: body.worktreeBranch,
      worktreeStatus: body.worktreeStatus,
      worktreeMessage: body.worktreeMessage,
    });
  }

  @Delete(":taskId")
  delete(@Param("taskId") taskId: string): Task {
    if (!this.tasksService.canDelete(taskId)) {
      throw new ForbiddenException("This task is currently processing.");
    }

    const removed = this.tasksService.delete(taskId);
    if (!removed) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    return removed;
  }

  @Patch(":taskId/phase")
  async move(
    @Param("taskId") taskId: string,
    @Body() body: MoveTaskBody,
  ): Promise<Task> {
    if (!this.isTaskPhase(body?.phase)) {
      throw new BadRequestException(
        `phase must be one of: ${TASK_PHASES.join(", ")}.`,
      );
    }

    const existing = this.tasksService.get(taskId);
    if (!existing) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    this.assertMoveAllowed(existing, body.phase);

    const approval = this.approvalGateService.consumeApprovedToken(
      taskId,
      existing.phase,
      body.phase,
      body.approvalToken,
    );
    if (!approval.ok) {
      throw new ForbiddenException(approval.reason);
    }

    let updated = this.tasksService.move(taskId, body.phase);
    if (!updated) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    if (body.phase === "done") {
      return (
        this.tasksService.updateAgentState(taskId, {
          agentStatus: "done",
          sessionId: updated.sessionId,
        }) ?? updated
      );
    }

    const role = this.mapPhaseToRole(updated.phase);
    if (role) {
      updated =
        this.tasksService.updateAgentState(taskId, {
          agentRole: role,
          agentStatus: "processing",
          agentMessage: undefined,
        }) ?? updated;
    }

    if (role) {
      const sessionId = this.sessionsService.createManagedSession({
        taskId,
        role,
        taskTitle: updated.title,
        taskDescription: updated.description,
        screenshotBase64: updated.screenshotBase64,
        githubRepoOwner: process.env.GITHUB_REPOSITORY_OWNER,
        githubRepoName: process.env.GITHUB_REPOSITORY_NAME,
        githubPrUrl: updated.githubPrUrl,
        githubPrId: updated.githubPrId,
      });
      return (
        this.tasksService.attachSession(taskId, sessionId) ??
        this.tasksService.updateAgentState(taskId, { sessionId }) ??
        updated
      );
    }

    return updated;
  }

  @Post(":taskId/restart")
  async restart(@Param("taskId") taskId: string): Promise<Task> {
    const existing = this.tasksService.get(taskId);
    if (!existing) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    if (existing.agentStatus !== "failed") {
      throw new ForbiddenException("Only failed tasks can be restarted.");
    }

    const role = this.mapPhaseToRole(existing.phase);
    if (!role) {
      throw new ForbiddenException("This task does not have an active agent.");
    }

    const reset =
      this.tasksService.updateAgentState(taskId, {
        agentRole: role,
        agentStatus: "processing",
        agentMessage: undefined,
      }) ?? existing;

    const sessionId = this.sessionsService.createManagedSession({
      taskId,
      role,
      taskTitle: reset.title,
      taskDescription: reset.description,
      screenshotBase64: reset.screenshotBase64,
      githubRepoOwner: process.env.GITHUB_REPOSITORY_OWNER,
      githubRepoName: process.env.GITHUB_REPOSITORY_NAME,
      githubPrUrl: reset.githubPrUrl,
      githubPrId: reset.githubPrId,
    });

    return this.tasksService.attachSession(taskId, sessionId) ?? reset;
  }

  @Post(":taskId/stop")
  async stop(@Param("taskId") taskId: string): Promise<Task> {
    const existing = this.tasksService.get(taskId);
    if (!existing) {
      throw new NotFoundException(`Task ${taskId} was not found`);
    }

    if (existing.agentStatus !== "processing") {
      throw new ForbiddenException("Only processing tasks can be stopped.");
    }

    const result = await this.sessionsService.stopTaskSession(taskId);
    if (!result.stopped) {
      throw new BadRequestException(
        result.reason ?? "No active session found for this task.",
      );
    }

    return (
      this.tasksService.get(taskId) ??
      this.tasksService.updateAgentState(taskId, {
        agentStatus: "failed",
        agentMessage: "Stopped by user.",
        sessionId: existing.sessionId,
      }) ??
      existing
    );
  }

  private mapPhaseToRole(phase: TaskPhase): AgentRole | undefined {
    switch (phase) {
      case "in-progress":
        return "dev";
      case "in-review":
        return "reviewer";
      case "testing":
        return "tester";
      default:
        return undefined;
    }
  }

  private isTaskPhase(value: unknown): value is TaskPhase {
    return (
      typeof value === "string" && TASK_PHASES.includes(value as TaskPhase)
    );
  }

  private assertMoveAllowed(existing: Task, nextPhase: TaskPhase): void {
    if (existing.agentStatus === "processing") {
      throw new ForbiddenException("This task is currently processing.");
    }

    if (existing.agentStatus === "failed") {
      throw new ForbiddenException(
        "Restart the failed agent before moving this task.",
      );
    }

    const protectedProgression: TaskPhase[] = [
      "in-progress",
      "in-review",
      "testing",
    ];
    if (
      existing.agentStatus === "done" &&
      protectedProgression.includes(existing.phase)
    ) {
      const expectedNext = this.getNextPhase(existing.phase);
      if (nextPhase !== expectedNext) {
        throw new ForbiddenException(
          `This task can only move forward to ${expectedNext} after the agent completes.`,
        );
      }
    }
  }

  private getNextPhase(phase: TaskPhase): TaskPhase | undefined {
    switch (phase) {
      case "todo":
        return "in-progress";
      case "in-progress":
        return "in-review";
      case "in-review":
        return "testing";
      case "testing":
        return "done";
      default:
        return undefined;
    }
  }

  private parseQueryInteger(
    raw: string,
    field: string,
    options: { min: number },
  ): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < options.min) {
      const constraint =
        options.min === 0 ? "a non-negative integer" : "a positive integer";
      throw new BadRequestException(`${field} must be ${constraint}.`);
    }
    return value;
  }
}
