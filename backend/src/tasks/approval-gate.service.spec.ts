import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  ApprovalGateService,
  type ApprovalRetentionAuditEntry,
} from "@src/tasks/approval-gate.service";
import { type StateStoreService } from "@src/tasks/state-store.service";

type PersistedState = {
  tasks: unknown[];
  approvalGate: {
    enabled: boolean;
    protectedPhases: Array<
      "todo" | "in-progress" | "in-review" | "testing" | "done"
    >;
    requests: Array<{
      id: string;
      taskId: string;
      fromPhase: "todo" | "in-progress" | "in-review" | "testing" | "done";
      toPhase: "todo" | "in-progress" | "in-review" | "testing" | "done";
      status: "pending" | "approved" | "rejected";
      createdAt: string;
      actor?: string;
      note?: string;
      decidedAt?: string;
      consumedAt?: string;
    }>;
    retentionAudit: ApprovalRetentionAuditEntry[];
  };
};

class MockStateStore {
  constructor(private state: PersistedState) {}

  async getState(): Promise<PersistedState> {
    return JSON.parse(JSON.stringify(this.state)) as PersistedState;
  }

  async setApprovalGateState(
    state: PersistedState["approvalGate"],
  ): Promise<void> {
    this.state.approvalGate = JSON.parse(
      JSON.stringify(state),
    ) as PersistedState["approvalGate"];
  }
}

const DEFAULT_STATE: PersistedState = {
  tasks: [],
  approvalGate: {
    enabled: true,
    protectedPhases: ["testing", "done"],
    requests: [],
    retentionAudit: [],
  },
};

function createService(seed: PersistedState = DEFAULT_STATE): {
  service: ApprovalGateService;
  store: MockStateStore;
} {
  const store = new MockStateStore(
    JSON.parse(JSON.stringify(seed)) as PersistedState,
  );
  const service = new ApprovalGateService(
    store as unknown as StateStoreService,
  );
  return { service, store };
}

describe("ApprovalGateService", () => {
  beforeEach(() => {
    process.env.APPROVAL_HISTORY_MAX_RECORDS = "2000";
    process.env.APPROVAL_HISTORY_MAX_AGE_DAYS = "90";
    process.env.APPROVAL_HISTORY_PRUNE_INTERVAL_MS = "300000";
    process.env.APPROVAL_RETENTION_UPDATE_MIN_INTERVAL_MS = "2000";
  });

  afterEach(() => {
    delete process.env.APPROVAL_HISTORY_MAX_RECORDS;
    delete process.env.APPROVAL_HISTORY_MAX_AGE_DAYS;
    delete process.env.APPROVAL_HISTORY_PRUNE_INTERVAL_MS;
    delete process.env.APPROVAL_RETENTION_UPDATE_MIN_INTERVAL_MS;
    jest.restoreAllMocks();
  });

  it("rejects out-of-bounds retention updates", async () => {
    const { service } = createService();
    await service.onModuleInit();

    expect(() =>
      service.validateRetentionPolicyUpdate({ maxHistoryCount: 9 }),
    ).toThrow("maxHistoryCount must be between 10 and 100000.");

    service.onModuleDestroy();
  });

  it("rate limits updates during cooldown window", async () => {
    process.env.APPROVAL_RETENTION_UPDATE_MIN_INTERVAL_MS = "60000";
    const { service } = createService();
    await service.onModuleInit();

    const validated = service.validateRetentionPolicyUpdate({
      maxAgeDays: 100,
    });
    service.updateRetentionPolicy(validated, {
      actor: "test",
      source: "spec",
    });

    expect(() =>
      service.validateRetentionPolicyUpdate({ maxAgeDays: 101 }),
    ).toThrow("Retention policy updates are rate limited.");

    service.onModuleDestroy();
  });

  it("records retention audit metadata and change payload", async () => {
    jest
      .spyOn(global.Date, "now")
      .mockReturnValue(new Date("2026-01-01T00:00:00.000Z").valueOf());

    const { service } = createService();
    await service.onModuleInit();

    const validated = service.validateRetentionPolicyUpdate({
      maxHistoryCount: 500,
      pruneIntervalMs: 120000,
    });
    service.updateRetentionPolicy(validated, {
      actor: "board-ui",
      source: "runtime-diagnostics-panel",
    });

    const audit = service.listRetentionAudit(1);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe("board-ui");
    expect(audit[0]?.source).toBe("runtime-diagnostics-panel");
    expect(audit[0]?.changes).toEqual({
      maxHistoryCount: 500,
      pruneIntervalMs: 120000,
    });

    service.onModuleDestroy();
  });

  it("restores persisted audit trail and cooldown state on module init", async () => {
    const createdAt = "2026-07-01T12:00:00.000Z";
    const seeded: PersistedState = {
      tasks: [],
      approvalGate: {
        enabled: true,
        protectedPhases: ["testing", "done"],
        requests: [],
        retentionAudit: [
          {
            id: "audit-1",
            createdAt,
            actor: "board-ui",
            source: "runtime-diagnostics-panel",
            changes: { maxAgeDays: 120 },
          },
        ],
      },
    };

    const { service } = createService(seeded);
    await service.onModuleInit();

    const loadedAudit = service.listRetentionAudit(5);
    expect(loadedAudit).toHaveLength(1);
    expect(loadedAudit[0]?.createdAt).toBe(createdAt);

    jest
      .spyOn(global.Date, "now")
      .mockReturnValue(new Date("2026-07-01T12:00:01.000Z").valueOf());

    expect(() =>
      service.validateRetentionPolicyUpdate({ maxAgeDays: 121 }),
    ).toThrow("Retention policy updates are rate limited.");

    service.onModuleDestroy();
  });

  it("persists audit entries when retention policy is updated", async () => {
    const { service, store } = createService();
    await service.onModuleInit();

    const validated = service.validateRetentionPolicyUpdate({
      maxAgeDays: 180,
    });
    service.updateRetentionPolicy(validated, {
      actor: "qa",
      source: "test-suite",
    });

    const persisted = await store.getState();
    expect(persisted.approvalGate.retentionAudit.length).toBeGreaterThan(0);
    expect(persisted.approvalGate.retentionAudit[0]?.actor).toBe("qa");
    expect(persisted.approvalGate.retentionAudit[0]?.changes).toEqual({
      maxAgeDays: 180,
    });

    service.onModuleDestroy();
  });

  it("clamps listRequestsPage limit to minimum and offset to zero", async () => {
    const { service } = createService();
    await service.onModuleInit();

    service.evaluateTransition("task-1", "todo", "testing");
    service.evaluateTransition("task-2", "todo", "testing");

    const page = service.listRequestsPage({ limit: 0, offset: -99 });

    expect(page.limit).toBe(1);
    expect(page.offset).toBe(0);
    expect(page.items).toHaveLength(1);

    service.onModuleDestroy();
  });

  it("clamps listRequestsPage limit to maximum", async () => {
    const { service } = createService();
    await service.onModuleInit();

    service.evaluateTransition("task-1", "todo", "testing");
    service.evaluateTransition("task-2", "todo", "testing");

    const page = service.listRequestsPage({ limit: 9999, offset: 0 });

    expect(page.limit).toBe(200);
    expect(page.offset).toBe(0);
    expect(page.items).toHaveLength(2);

    service.onModuleDestroy();
  });
});
