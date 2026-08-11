import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SessionsService } from "@src/sessions/sessions.service";
import {
  ApprovalGateService,
  type ApprovalRequest,
  type ApprovalRequestPage,
  type ApprovalRetentionAuditEntry,
  type ApprovalRetentionStatus,
  type ValidatedApprovalRetentionUpdate,
} from "@src/tasks/approval-gate.service";
import { TasksController } from "@src/tasks/tasks.controller";
import { TasksService } from "@src/tasks/tasks.service";
import * as request from "supertest";

interface ApprovalGateMock {
  getStatus: jest.Mock;
  setEnabled: jest.Mock;
  listRequestsPage: jest.Mock;
  getRetentionStatus: jest.Mock;
  listRetentionAudit: jest.Mock;
  validateRetentionPolicyUpdate: jest.Mock;
  updateRetentionPolicy: jest.Mock;
  evaluateTransition: jest.Mock;
  decideRequest: jest.Mock;
  consumeApprovedToken: jest.Mock;
}

interface TasksServiceMock {
  get: jest.Mock;
  list: jest.Mock;
  upsert: jest.Mock;
  move: jest.Mock;
  attachSession: jest.Mock;
  attachWorktree: jest.Mock;
  updateAgentState: jest.Mock;
  canDelete: jest.Mock;
}

interface SessionsServiceMock {
  createManagedSession: jest.Mock;
  stopTaskSession: jest.Mock;
}

describe("TasksController retention endpoints (HTTP)", () => {
  let app: INestApplication;
  let approvalGateService: ApprovalGateMock;
  let tasksService: TasksServiceMock;
  let sessionsService: SessionsServiceMock;

  beforeAll(async () => {
    tasksService = {
      get: jest.fn(),
      list: jest.fn(),
      upsert: jest.fn(),
      move: jest.fn(),
      attachSession: jest.fn(),
      attachWorktree: jest.fn(),
      updateAgentState: jest.fn(),
      canDelete: jest.fn().mockReturnValue(true),
    };

    sessionsService = {
      createManagedSession: jest.fn(),
      stopTaskSession: jest.fn(),
    };

    approvalGateService = {
      getStatus: jest.fn(),
      setEnabled: jest.fn(),
      listRequestsPage: jest.fn(),
      getRetentionStatus: jest.fn(),
      listRetentionAudit: jest.fn(),
      validateRetentionPolicyUpdate: jest.fn(),
      updateRetentionPolicy: jest.fn(),
      evaluateTransition: jest.fn(),
      decideRequest: jest.fn(),
      consumeApprovedToken: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        {
          provide: TasksService,
          useValue: tasksService,
        },
        {
          provide: SessionsService,
          useValue: sessionsService,
        },
        {
          provide: ApprovalGateService,
          useValue: approvalGateService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /tasks/approval-gate/retention returns retention status", async () => {
    const expected: ApprovalRetentionStatus = {
      maxHistoryCount: 2000,
      maxAgeDays: 90,
      pruneIntervalMs: 300000,
      updateMinIntervalMs: 2000,
      bounds: {
        maxHistoryCount: { min: 10, max: 100000 },
        maxAgeDays: { min: 1, max: 3650 },
        pruneIntervalMs: { min: 10000, max: 86400000 },
      },
      totalRequests: 5,
      pendingRequests: 1,
      retainedHistoryRequests: 4,
      lastPrunedCount: 0,
    };
    approvalGateService.getRetentionStatus.mockReturnValue(expected);

    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/retention",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
    expect(approvalGateService.getRetentionStatus).toHaveBeenCalledTimes(1);
  });

  it("GET /tasks/approval-gate/retention/audit forwards parsed limit", async () => {
    const audit: ApprovalRetentionAuditEntry[] = [
      {
        id: "audit-1",
        createdAt: "2026-08-02T10:00:00.000Z",
        actor: "board-ui",
        source: "runtime-diagnostics-panel",
        changes: { maxAgeDays: 120 },
      },
    ];
    approvalGateService.listRetentionAudit.mockReturnValue(audit);

    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/retention/audit?limit=15",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(audit);
    expect(approvalGateService.listRetentionAudit).toHaveBeenCalledWith(15);
  });

  it("GET /tasks/approval-gate/retention/audit returns 400 for malformed limit", async () => {
    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/retention/audit?limit=abc",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("limit must be a positive integer.");
    expect(approvalGateService.listRetentionAudit).not.toHaveBeenCalled();
  });

  it("GET /tasks/approval-gate/retention/audit returns 400 for non-positive limit", async () => {
    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/retention/audit?limit=0",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("limit must be a positive integer.");
    expect(approvalGateService.listRetentionAudit).not.toHaveBeenCalled();
  });

  it("GET /tasks/approval-gate/retention/audit returns 400 for negative limit", async () => {
    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/retention/audit?limit=-10",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("limit must be a positive integer.");
    expect(approvalGateService.listRetentionAudit).not.toHaveBeenCalled();
  });

  it("GET /tasks/approval-gate/retention/audit forwards large limit for service-level clamping", async () => {
    const audit: ApprovalRetentionAuditEntry[] = [];
    approvalGateService.listRetentionAudit.mockReturnValue(audit);

    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/retention/audit?limit=999999",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(audit);
    expect(approvalGateService.listRetentionAudit).toHaveBeenCalledWith(999999);
  });

  it("PATCH /tasks/approval-gate/retention updates policy and passes metadata", async () => {
    const validated: ValidatedApprovalRetentionUpdate = {
      maxHistoryCount: 500,
      maxAgeDays: 120,
      pruneIntervalMs: 120000,
    };
    const updatedStatus: ApprovalRetentionStatus = {
      maxHistoryCount: 500,
      maxAgeDays: 120,
      pruneIntervalMs: 120000,
      updateMinIntervalMs: 2000,
      bounds: {
        maxHistoryCount: { min: 10, max: 100000 },
        maxAgeDays: { min: 1, max: 3650 },
        pruneIntervalMs: { min: 10000, max: 86400000 },
      },
      totalRequests: 5,
      pendingRequests: 1,
      retainedHistoryRequests: 4,
      lastPrunedCount: 0,
    };

    approvalGateService.validateRetentionPolicyUpdate.mockReturnValue(
      validated,
    );
    approvalGateService.updateRetentionPolicy.mockReturnValue(updatedStatus);

    const response = await request(app.getHttpServer())
      .patch("/tasks/approval-gate/retention")
      .send({
        maxHistoryCount: 500,
        maxAgeDays: 120,
        pruneIntervalMs: 120000,
        actor: "board-ui",
        source: "runtime-diagnostics-panel",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updatedStatus);
    expect(
      approvalGateService.validateRetentionPolicyUpdate,
    ).toHaveBeenCalledWith({
      maxHistoryCount: 500,
      maxAgeDays: 120,
      pruneIntervalMs: 120000,
    });
    expect(approvalGateService.updateRetentionPolicy).toHaveBeenCalledWith(
      validated,
      {
        actor: "board-ui",
        source: "runtime-diagnostics-panel",
      },
    );
  });

  it("PATCH /tasks/approval-gate/retention returns 400 for invalid updates", async () => {
    approvalGateService.validateRetentionPolicyUpdate.mockImplementation(() => {
      throw new Error("maxAgeDays must be between 1 and 3650.");
    });

    const response = await request(app.getHttpServer())
      .patch("/tasks/approval-gate/retention")
      .send({ maxAgeDays: -1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "maxAgeDays must be between 1 and 3650.",
    );
  });

  it("PATCH /tasks/approval-gate returns 400 when enabled is missing", async () => {
    const response = await request(app.getHttpServer())
      .patch("/tasks/approval-gate")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("enabled must be a boolean.");
    expect(approvalGateService.setEnabled).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/approval-gate returns 400 when enabled is not a boolean", async () => {
    const response = await request(app.getHttpServer())
      .patch("/tasks/approval-gate")
      .send({ enabled: "true" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("enabled must be a boolean.");
    expect(approvalGateService.setEnabled).not.toHaveBeenCalled();
  });

  it("GET /tasks/approval-gate/requests forwards query params", async () => {
    const page: ApprovalRequestPage = {
      items: [
        {
          id: "req-1",
          taskId: "task-123",
          fromPhase: "in-review",
          toPhase: "testing",
          status: "pending",
          createdAt: "2026-08-02T10:00:00.000Z",
        },
      ],
      total: 1,
      limit: 10,
      offset: 5,
    };
    approvalGateService.listRequestsPage.mockReturnValue(page);

    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/requests?taskId=task-123&status=pending&limit=10&offset=5",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(page);
    expect(approvalGateService.listRequestsPage).toHaveBeenCalledWith({
      taskId: "task-123",
      status: "pending",
      limit: 10,
      offset: 5,
    });
  });

  it("GET /tasks/approval-gate/requests supports boundary limit/offset values", async () => {
    const page: ApprovalRequestPage = {
      items: [],
      total: 0,
      limit: 1,
      offset: 0,
    };
    approvalGateService.listRequestsPage.mockReturnValue(page);

    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/requests?limit=1&offset=0",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(page);
    expect(approvalGateService.listRequestsPage).toHaveBeenCalledWith({
      taskId: undefined,
      status: undefined,
      limit: 1,
      offset: 0,
    });
  });

  it("GET /tasks/approval-gate/requests returns 400 for malformed status", async () => {
    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/requests?status=unknown",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "status must be one of: pending, approved, rejected.",
    );
    expect(approvalGateService.listRequestsPage).not.toHaveBeenCalled();
  });

  it("GET /tasks/approval-gate/requests returns 400 for malformed limit", async () => {
    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/requests?limit=abc",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("limit must be a positive integer.");
    expect(approvalGateService.listRequestsPage).not.toHaveBeenCalled();
  });

  it("GET /tasks/approval-gate/requests returns 400 for malformed offset", async () => {
    const response = await request(app.getHttpServer()).get(
      "/tasks/approval-gate/requests?offset=-1",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "offset must be a non-negative integer.",
    );
    expect(approvalGateService.listRequestsPage).not.toHaveBeenCalled();
  });

  it("POST /tasks/approval-gate/evaluate returns approval-required payload", async () => {
    const requestRecord: ApprovalRequest = {
      id: "req-approval",
      taskId: "task-999",
      fromPhase: "in-review",
      toPhase: "testing",
      status: "pending",
      createdAt: "2026-08-02T11:00:00.000Z",
    };
    approvalGateService.evaluateTransition.mockReturnValue({
      approvalRequired: true,
      request: requestRecord,
    });

    const response = await request(app.getHttpServer())
      .post("/tasks/approval-gate/evaluate")
      .send({
        taskId: "task-999",
        fromPhase: "in-review",
        toPhase: "testing",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      approvalRequired: true,
      requestId: "req-approval",
      reason: "Human approval is required for this high-impact transition.",
    });
    expect(approvalGateService.evaluateTransition).toHaveBeenCalledWith(
      "task-999",
      "in-review",
      "testing",
    );
  });

  it("POST /tasks/approval-gate/evaluate returns non-blocking payload when approval is not required", async () => {
    approvalGateService.evaluateTransition.mockReturnValue({
      approvalRequired: false,
    });

    const response = await request(app.getHttpServer())
      .post("/tasks/approval-gate/evaluate")
      .send({
        taskId: "task-555",
        fromPhase: "todo",
        toPhase: "in-progress",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      approvalRequired: false,
    });
    expect(approvalGateService.evaluateTransition).toHaveBeenCalledWith(
      "task-555",
      "todo",
      "in-progress",
    );
  });

  it("POST /tasks/approval-gate/evaluate returns 400 for invalid fromPhase", async () => {
    const response = await request(app.getHttpServer())
      .post("/tasks/approval-gate/evaluate")
      .send({
        taskId: "task-556",
        fromPhase: "to-do",
        toPhase: "in-progress",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "fromPhase must be one of: todo, in-progress, in-review, testing, done.",
    );
    expect(approvalGateService.evaluateTransition).not.toHaveBeenCalled();
  });

  it("POST /tasks/approval-gate/evaluate returns 400 for missing taskId", async () => {
    const response = await request(app.getHttpServer())
      .post("/tasks/approval-gate/evaluate")
      .send({
        fromPhase: "todo",
        toPhase: "in-progress",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("taskId must be a non-empty string.");
    expect(approvalGateService.evaluateTransition).not.toHaveBeenCalled();
  });

  it("POST /tasks/approval-gate/requests/:requestId/decision returns decision payload", async () => {
    approvalGateService.decideRequest.mockReturnValue({
      id: "req-approval",
      taskId: "task-999",
      fromPhase: "in-review",
      toPhase: "testing",
      status: "approved",
      createdAt: "2026-08-02T11:00:00.000Z",
      decidedAt: "2026-08-02T11:01:00.000Z",
      actor: "reviewer-1",
      note: "Looks good",
    });

    const response = await request(app.getHttpServer())
      .post("/tasks/approval-gate/requests/req-approval/decision")
      .send({ approved: true, actor: "reviewer-1", note: "Looks good" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: "req-approval",
      status: "approved",
    });
    expect(approvalGateService.decideRequest).toHaveBeenCalledWith(
      "req-approval",
      true,
      "reviewer-1",
      "Looks good",
    );
  });

  it("POST /tasks/approval-gate/requests/:requestId/decision returns 404 when request is missing", async () => {
    approvalGateService.decideRequest.mockReturnValue(undefined);

    const response = await request(app.getHttpServer())
      .post("/tasks/approval-gate/requests/missing/decision")
      .send({ approved: false, actor: "reviewer-2", note: "Rejected" });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(
      "Approval request missing was not found",
    );
  });

  it("POST /tasks/approval-gate/requests/:requestId/decision returns rejection decision payload with metadata", async () => {
    approvalGateService.decideRequest.mockReturnValue({
      id: "req-reject",
      taskId: "task-222",
      fromPhase: "in-review",
      toPhase: "testing",
      status: "rejected",
      createdAt: "2026-08-02T11:00:00.000Z",
      decidedAt: "2026-08-02T11:02:00.000Z",
      actor: "reviewer-2",
      note: "Needs additional checks",
    });

    const response = await request(app.getHttpServer())
      .post("/tasks/approval-gate/requests/req-reject/decision")
      .send({
        approved: false,
        actor: "reviewer-2",
        note: "Needs additional checks",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: "req-reject",
      status: "rejected",
    });
    expect(approvalGateService.decideRequest).toHaveBeenCalledWith(
      "req-reject",
      false,
      "reviewer-2",
      "Needs additional checks",
    );
  });

  it("POST /tasks/approval-gate/requests/:requestId/decision returns 400 for malformed payload", async () => {
    const response = await request(app.getHttpServer())
      .post("/tasks/approval-gate/requests/req-malformed/decision")
      .send({ actor: "reviewer-3" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("approved must be a boolean.");
    expect(approvalGateService.decideRequest).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/:taskId/phase returns 404 when task is missing", async () => {
    tasksService.get.mockReturnValue(undefined);

    const response = await request(app.getHttpServer())
      .patch("/tasks/missing/phase")
      .send({ phase: "in-progress" });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Task missing was not found");
    expect(approvalGateService.consumeApprovedToken).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/:taskId/phase returns 400 for invalid phase value", async () => {
    const response = await request(app.getHttpServer())
      .patch("/tasks/task-invalid/phase")
      .send({ phase: "to-do" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "phase must be one of: todo, in-progress, in-review, testing, done.",
    );
    expect(tasksService.get).not.toHaveBeenCalled();
    expect(approvalGateService.consumeApprovedToken).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/:taskId/phase returns 400 when phase is missing", async () => {
    const response = await request(app.getHttpServer())
      .patch("/tasks/task-missing-phase/phase")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "phase must be one of: todo, in-progress, in-review, testing, done.",
    );
    expect(tasksService.get).not.toHaveBeenCalled();
    expect(approvalGateService.consumeApprovedToken).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/:taskId/phase returns 403 when protected transition has no valid approval token", async () => {
    tasksService.get.mockReturnValue({
      id: "task-1",
      title: "Review security checks",
      phase: "in-review",
    });
    approvalGateService.consumeApprovedToken.mockReturnValue({
      ok: false,
      reason: "Approval token is required for this transition.",
    });

    const response = await request(app.getHttpServer())
      .patch("/tasks/task-1/phase")
      .send({ phase: "testing" });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "Approval token is required for this transition.",
    );
    expect(approvalGateService.consumeApprovedToken).toHaveBeenCalledWith(
      "task-1",
      "in-review",
      "testing",
      undefined,
    );
    expect(tasksService.move).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/:taskId/phase returns 403 when approval token does not match transition", async () => {
    tasksService.get.mockReturnValue({
      id: "task-mismatch",
      title: "Mismatch transition",
      phase: "in-review",
    });
    approvalGateService.consumeApprovedToken.mockReturnValue({
      ok: false,
      reason: "Approval request does not match this transition.",
    });

    const response = await request(app.getHttpServer())
      .patch("/tasks/task-mismatch/phase")
      .send({ phase: "testing", approvalToken: "req-other" });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "Approval request does not match this transition.",
    );
    expect(approvalGateService.consumeApprovedToken).toHaveBeenCalledWith(
      "task-mismatch",
      "in-review",
      "testing",
      "req-other",
    );
    expect(tasksService.move).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/:taskId/phase returns 403 when approval token exists but is not approved", async () => {
    tasksService.get.mockReturnValue({
      id: "task-unapproved",
      title: "Unapproved request",
      phase: "in-review",
    });
    approvalGateService.consumeApprovedToken.mockReturnValue({
      ok: false,
      reason: "Approval request has not been approved.",
    });

    const response = await request(app.getHttpServer())
      .patch("/tasks/task-unapproved/phase")
      .send({ phase: "testing", approvalToken: "req-pending" });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "Approval request has not been approved.",
    );
    expect(approvalGateService.consumeApprovedToken).toHaveBeenCalledWith(
      "task-unapproved",
      "in-review",
      "testing",
      "req-pending",
    );
    expect(tasksService.move).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/:taskId/phase creates a dev session when moving to in-progress", async () => {
    const inProgressTask = {
      id: "task-2",
      title: "Implement board flow",
      description: "Build move endpoint",
      phase: "in-progress",
      screenshotBase64: "abc123",
    };
    tasksService.get.mockReturnValue({
      id: "task-2",
      title: "Implement board flow",
      description: "Build move endpoint",
      phase: "todo",
      screenshotBase64: "abc123",
    });
    approvalGateService.consumeApprovedToken.mockReturnValue({ ok: true });
    tasksService.move.mockReturnValue(inProgressTask);
    tasksService.updateAgentState.mockReturnValue({
      ...inProgressTask,
      agentRole: "dev",
      agentStatus: "processing",
    });
    sessionsService.createManagedSession.mockReturnValue("sess-2");
    tasksService.attachSession.mockReturnValue({
      id: "task-2",
      title: "Implement board flow",
      description: "Build move endpoint",
      phase: "in-progress",
      screenshotBase64: "abc123",
      sessionId: "sess-2",
    });

    const response = await request(app.getHttpServer())
      .patch("/tasks/task-2/phase")
      .send({ phase: "in-progress" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: "task-2",
        phase: "in-progress",
        sessionId: "sess-2",
      }),
    );

    expect(tasksService.move).toHaveBeenCalledWith("task-2", "in-progress");
    expect(tasksService.attachWorktree).not.toHaveBeenCalled();
    expect(sessionsService.createManagedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-2",
        role: "dev",
        taskTitle: "Implement board flow",
        taskDescription: "Build move endpoint",
      }),
    );
    expect(tasksService.attachSession).toHaveBeenCalledWith("task-2", "sess-2");
  });

  it("PATCH /tasks/:taskId/phase returns 404 when move result is missing after approval", async () => {
    tasksService.get.mockReturnValue({
      id: "task-3",
      title: "Stale task",
      phase: "todo",
    });
    approvalGateService.consumeApprovedToken.mockReturnValue({ ok: true });
    tasksService.move.mockReturnValue(undefined);

    const response = await request(app.getHttpServer())
      .patch("/tasks/task-3/phase")
      .send({ phase: "in-review" });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Task task-3 was not found");
    expect(sessionsService.createManagedSession).not.toHaveBeenCalled();
  });

  it("PATCH /tasks/:taskId/phase creates reviewer session without worktree for non-in-progress transitions", async () => {
    const inReviewTask = {
      id: "task-4",
      title: "Review architecture",
      description: "Prepare review notes",
      phase: "in-review",
      githubPrUrl: "https://github.com/acme/demo/pull/42",
      githubPrId: "42",
    };
    tasksService.get.mockReturnValue({
      id: "task-4",
      title: "Review architecture",
      description: "Prepare review notes",
      phase: "todo",
    });
    approvalGateService.consumeApprovedToken.mockReturnValue({ ok: true });
    tasksService.move.mockReturnValue(inReviewTask);
    tasksService.updateAgentState.mockReturnValue({
      ...inReviewTask,
      agentRole: "reviewer",
      agentStatus: "processing",
    });
    sessionsService.createManagedSession.mockReturnValue("sess-review-4");
    tasksService.attachSession.mockReturnValue({
      id: "task-4",
      title: "Review architecture",
      description: "Prepare review notes",
      phase: "in-review",
      sessionId: "sess-review-4",
    });

    const response = await request(app.getHttpServer())
      .patch("/tasks/task-4/phase")
      .send({ phase: "in-review" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: "task-4",
        phase: "in-review",
        sessionId: "sess-review-4",
      }),
    );
    expect(tasksService.attachWorktree).not.toHaveBeenCalled();
    expect(sessionsService.createManagedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-4",
        role: "reviewer",
        taskTitle: "Review architecture",
        taskDescription: "Prepare review notes",
        githubPrUrl: "https://github.com/acme/demo/pull/42",
        githubPrId: "42",
      }),
    );
    expect(tasksService.attachSession).toHaveBeenCalledWith(
      "task-4",
      "sess-review-4",
    );
  });

  it("POST /tasks/:taskId/stop stops an active processing task", async () => {
    tasksService.get
      .mockReturnValueOnce({
        id: "task-stop-1",
        title: "Stop this task",
        phase: "in-progress",
        agentStatus: "processing",
        sessionId: "sess-stop-1",
      })
      .mockReturnValueOnce({
        id: "task-stop-1",
        title: "Stop this task",
        phase: "in-progress",
        agentStatus: "failed",
        agentMessage: "Stopped by user.",
        sessionId: "sess-stop-1",
      });
    sessionsService.stopTaskSession.mockImplementation(async () => ({
      stopped: true,
      sessionId: "sess-stop-1",
    }));

    const response = await request(app.getHttpServer()).post(
      "/tasks/task-stop-1/stop",
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: "task-stop-1",
        agentStatus: "failed",
        agentMessage: "Stopped by user.",
      }),
    );
    expect(sessionsService.stopTaskSession).toHaveBeenCalledWith("task-stop-1");
  });

  it("POST /tasks/:taskId/stop returns 403 when task is not processing", async () => {
    tasksService.get.mockReturnValue({
      id: "task-stop-2",
      title: "Already done",
      phase: "in-progress",
      agentStatus: "done",
    });

    const response = await request(app.getHttpServer()).post(
      "/tasks/task-stop-2/stop",
    );

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Only processing tasks can be stopped.");
    expect(sessionsService.stopTaskSession).not.toHaveBeenCalled();
  });
});
