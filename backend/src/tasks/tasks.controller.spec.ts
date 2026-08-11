import { BadRequestException } from "@nestjs/common";

import { type SessionsService } from "@src/sessions/sessions.service";
import {
  type ApprovalGateService,
  type ApprovalRetentionAuditEntry,
  type ApprovalRetentionStatus,
  type ValidatedApprovalRetentionUpdate,
} from "@src/tasks/approval-gate.service";
import { TasksController } from "@src/tasks/tasks.controller";
import { type TasksService } from "@src/tasks/tasks.service";
import { afterEach, describe, it } from "node:test";

type DeepMock<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? jest.Mock<R, A>
    : T[K];
};

function createController(): {
  controller: TasksController;
  approvalGate: DeepMock<ApprovalGateService>;
} {
  const tasksService = {
    get: jest.fn(),
    list: jest.fn(),
    upsert: jest.fn(),
    move: jest.fn(),
    attachSession: jest.fn(),
    attachWorktree: jest.fn(),
    updateAgentState: jest.fn(),
    canDelete: jest.fn().mockReturnValue(true),
  } as unknown as DeepMock<TasksService>;

  const sessionsService = {
    createManagedSession: jest.fn(),
  } as unknown as DeepMock<SessionsService>;

  const approvalGate = {
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
  } as unknown as DeepMock<ApprovalGateService>;

  const controller = new TasksController(
    tasksService as unknown as TasksService,
    sessionsService as unknown as SessionsService,
    approvalGate as unknown as ApprovalGateService,
  );

  return { controller, approvalGate };
}

describe("TasksController retention endpoints", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns retention status from approval gate service", () => {
    const { controller, approvalGate } = createController();
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
      totalRequests: 0,
      pendingRequests: 0,
      retainedHistoryRequests: 0,
      lastPrunedCount: 0,
    };
    approvalGate.getRetentionStatus.mockReturnValue(expected);

    expect(controller.getApprovalRetention()).toEqual(expected);
    expect(approvalGate.getRetentionStatus).toHaveBeenCalledTimes(1);
  });

  it("returns retention audit entries and parses limit query", () => {
    const { controller, approvalGate } = createController();
    const audit: ApprovalRetentionAuditEntry[] = [
      {
        id: "audit-1",
        createdAt: "2026-08-02T10:00:00.000Z",
        actor: "board-ui",
        source: "runtime-diagnostics-panel",
        changes: { maxAgeDays: 120 },
      },
    ];
    approvalGate.listRetentionAudit.mockReturnValue(audit);

    const result = controller.getApprovalRetentionAudit("15");
    expect(result).toEqual(audit);
    expect(approvalGate.listRetentionAudit).toHaveBeenCalledWith(15);
  });

  it("updates retention policy with validated payload and metadata", () => {
    const { controller, approvalGate } = createController();
    const validated: ValidatedApprovalRetentionUpdate = {
      maxHistoryCount: 500,
      maxAgeDays: 100,
      pruneIntervalMs: 120000,
    };
    const updatedStatus: ApprovalRetentionStatus = {
      maxHistoryCount: 500,
      maxAgeDays: 100,
      pruneIntervalMs: 120000,
      updateMinIntervalMs: 2000,
      bounds: {
        maxHistoryCount: { min: 10, max: 100000 },
        maxAgeDays: { min: 1, max: 3650 },
        pruneIntervalMs: { min: 10000, max: 86400000 },
      },
      totalRequests: 1,
      pendingRequests: 0,
      retainedHistoryRequests: 1,
      lastPrunedCount: 0,
      lastPrunedAt: "2026-08-02T10:00:00.000Z",
    };
    approvalGate.validateRetentionPolicyUpdate.mockReturnValue(validated);
    approvalGate.updateRetentionPolicy.mockReturnValue(updatedStatus);

    const result = controller.updateApprovalRetention({
      maxHistoryCount: 500,
      maxAgeDays: 100,
      pruneIntervalMs: 120000,
      actor: "board-ui",
      source: "runtime-diagnostics-panel",
    });

    expect(result).toEqual(updatedStatus);
    expect(approvalGate.validateRetentionPolicyUpdate).toHaveBeenCalledWith({
      maxHistoryCount: 500,
      maxAgeDays: 100,
      pruneIntervalMs: 120000,
    });
    expect(approvalGate.updateRetentionPolicy).toHaveBeenCalledWith(validated, {
      actor: "board-ui",
      source: "runtime-diagnostics-panel",
    });
  });

  it("maps validation failures to BadRequestException", () => {
    const { controller, approvalGate } = createController();
    approvalGate.validateRetentionPolicyUpdate.mockImplementation(() => {
      throw new Error("maxAgeDays must be between 1 and 3650.");
    });

    expect(() =>
      controller.updateApprovalRetention({
        maxAgeDays: -1,
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      controller.updateApprovalRetention({
        maxAgeDays: -1,
      }),
    ).toThrow("maxAgeDays must be between 1 and 3650.");
  });
});
