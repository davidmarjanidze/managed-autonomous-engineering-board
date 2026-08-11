import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { StateStoreService } from "@src/tasks/state-store.service";
import { type TaskPhase } from "@src/tasks/tasks.service";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  fromPhase: TaskPhase;
  toPhase: TaskPhase;
  status: "pending" | "approved" | "rejected";
  actor?: string;
  note?: string;
  createdAt: string;
  decidedAt?: string;
  consumedAt?: string;
}

export interface ApprovalEvaluation {
  approvalRequired: boolean;
  request?: ApprovalRequest;
}

export interface ApprovalRequestQuery {
  taskId?: string;
  status?: "pending" | "approved" | "rejected";
  limit?: number;
  offset?: number;
}

export interface ApprovalRequestPage {
  items: ApprovalRequest[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApprovalRetentionStatus {
  maxHistoryCount: number;
  maxAgeDays: number;
  pruneIntervalMs: number;
  updateMinIntervalMs: number;
  bounds: {
    maxHistoryCount: { min: number; max: number };
    maxAgeDays: { min: number; max: number };
    pruneIntervalMs: { min: number; max: number };
  };
  totalRequests: number;
  pendingRequests: number;
  retainedHistoryRequests: number;
  lastPrunedAt?: string;
  lastPrunedCount: number;
}

export interface ApprovalRetentionUpdate {
  maxHistoryCount?: number;
  maxAgeDays?: number;
  pruneIntervalMs?: number;
}

export interface ValidatedApprovalRetentionUpdate {
  maxHistoryCount?: number;
  maxAgeDays?: number;
  pruneIntervalMs?: number;
}

export interface ApprovalRetentionUpdateMetadata {
  actor?: string;
  source?: string;
}

export interface ApprovalRetentionAuditEntry {
  id: string;
  createdAt: string;
  actor: string;
  source: string;
  changes: ValidatedApprovalRetentionUpdate;
}

@Injectable()
export class ApprovalGateService implements OnModuleInit, OnModuleDestroy {
  private static readonly MIN_HISTORY_COUNT = 10;
  private static readonly MAX_HISTORY_COUNT = 100_000;
  private static readonly MIN_MAX_AGE_DAYS = 1;
  private static readonly MAX_MAX_AGE_DAYS = 3650;
  private static readonly MIN_PRUNE_INTERVAL_MS = 10_000;
  private static readonly MAX_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

  private enabled = true;
  private readonly protectedPhases = new Set<TaskPhase>(["testing", "done"]);
  private readonly requests = new Map<string, ApprovalRequest>();
  private maxHistoryCount = this.clampRange(
    this.parsePositiveInteger(process.env.APPROVAL_HISTORY_MAX_RECORDS, 2000),
    ApprovalGateService.MIN_HISTORY_COUNT,
    ApprovalGateService.MAX_HISTORY_COUNT,
  );
  private maxAgeDays = this.clampRange(
    this.parsePositiveInteger(process.env.APPROVAL_HISTORY_MAX_AGE_DAYS, 90),
    ApprovalGateService.MIN_MAX_AGE_DAYS,
    ApprovalGateService.MAX_MAX_AGE_DAYS,
  );
  private pruneIntervalMs = this.clampRange(
    this.parsePositiveInteger(
      process.env.APPROVAL_HISTORY_PRUNE_INTERVAL_MS,
      5 * 60 * 1000,
    ),
    ApprovalGateService.MIN_PRUNE_INTERVAL_MS,
    ApprovalGateService.MAX_PRUNE_INTERVAL_MS,
  );
  private readonly updateMinIntervalMs = this.clampRange(
    this.parsePositiveInteger(
      process.env.APPROVAL_RETENTION_UPDATE_MIN_INTERVAL_MS,
      2_000,
    ),
    250,
    60_000,
  );
  private pruneTimer: NodeJS.Timeout | null = null;
  private lastPrunedAt?: string;
  private lastPrunedCount = 0;
  private lastRetentionPolicyUpdateAtMs = 0;
  private readonly retentionAuditLimit = 100;
  private readonly retentionAuditTrail: ApprovalRetentionAuditEntry[] = [];

  constructor(private readonly stateStore: StateStoreService) {}

  async onModuleInit(): Promise<void> {
    const persisted = await this.stateStore.getState();
    this.enabled = persisted.approvalGate.enabled;
    this.protectedPhases.clear();
    for (const phase of persisted.approvalGate.protectedPhases) {
      this.protectedPhases.add(phase);
    }

    this.requests.clear();
    for (const request of persisted.approvalGate.requests) {
      this.requests.set(request.id, request);
    }

    this.retentionAuditTrail.length = 0;
    for (const entry of persisted.approvalGate.retentionAudit ?? []) {
      this.retentionAuditTrail.push(entry);
    }
    this.retentionAuditTrail.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );

    const latestAudit = this.retentionAuditTrail[0];
    if (latestAudit) {
      const latestMs = Date.parse(latestAudit.createdAt);
      if (!Number.isNaN(latestMs)) {
        this.lastRetentionPolicyUpdateAtMs = latestMs;
      }
    }

    this.pruneHistory();
    this.resetPruneTimer();
  }

  onModuleDestroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  getStatus(): { enabled: boolean; protectedPhases: TaskPhase[] } {
    return {
      enabled: this.enabled,
      protectedPhases: Array.from(this.protectedPhases),
    };
  }

  setEnabled(enabled: boolean): {
    enabled: boolean;
    protectedPhases: TaskPhase[];
  } {
    this.enabled = enabled;
    void this.persist();
    return this.getStatus();
  }

  evaluateTransition(
    taskId: string,
    fromPhase: TaskPhase,
    toPhase: TaskPhase,
  ): ApprovalEvaluation {
    if (!this.requiresApproval(toPhase)) {
      return { approvalRequired: false };
    }

    const request: ApprovalRequest = {
      id: randomUUID(),
      taskId,
      fromPhase,
      toPhase,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.requests.set(request.id, request);
    void this.persist();

    return {
      approvalRequired: true,
      request,
    };
  }

  decideRequest(
    requestId: string,
    approved: boolean,
    actor?: string,
    note?: string,
  ): ApprovalRequest | undefined {
    const request = this.requests.get(requestId);
    if (!request) {
      return undefined;
    }

    const updated: ApprovalRequest = {
      ...request,
      status: approved ? "approved" : "rejected",
      actor,
      note,
      decidedAt: new Date().toISOString(),
    };
    this.requests.set(requestId, updated);
    void this.persist();
    return updated;
  }

  listRequestsPage(query: ApprovalRequestQuery = {}): ApprovalRequestPage {
    const limit = Math.max(1, Math.min(query.limit ?? 25, 200));
    const offset = Math.max(0, query.offset ?? 0);

    const all = Array.from(this.requests.values());
    const filteredByTask = query.taskId
      ? all.filter((request) => request.taskId === query.taskId)
      : all;

    const filtered = query.status
      ? filteredByTask.filter((request) => request.status === query.status)
      : filteredByTask;

    const sorted = filtered.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );

    return {
      items: sorted.slice(offset, offset + limit),
      total: sorted.length,
      limit,
      offset,
    };
  }

  listRequests(taskId?: string): ApprovalRequest[] {
    return this.listRequestsPage({ taskId, limit: 10_000, offset: 0 }).items;
  }

  getRetentionStatus(): ApprovalRetentionStatus {
    const all = Array.from(this.requests.values());
    const pending = all.filter(
      (request) => request.status === "pending",
    ).length;
    return {
      maxHistoryCount: this.maxHistoryCount,
      maxAgeDays: this.maxAgeDays,
      pruneIntervalMs: this.pruneIntervalMs,
      updateMinIntervalMs: this.updateMinIntervalMs,
      bounds: {
        maxHistoryCount: {
          min: ApprovalGateService.MIN_HISTORY_COUNT,
          max: ApprovalGateService.MAX_HISTORY_COUNT,
        },
        maxAgeDays: {
          min: ApprovalGateService.MIN_MAX_AGE_DAYS,
          max: ApprovalGateService.MAX_MAX_AGE_DAYS,
        },
        pruneIntervalMs: {
          min: ApprovalGateService.MIN_PRUNE_INTERVAL_MS,
          max: ApprovalGateService.MAX_PRUNE_INTERVAL_MS,
        },
      },
      totalRequests: all.length,
      pendingRequests: pending,
      retainedHistoryRequests: all.length - pending,
      lastPrunedAt: this.lastPrunedAt,
      lastPrunedCount: this.lastPrunedCount,
    };
  }

  updateRetentionPolicy(
    update: ValidatedApprovalRetentionUpdate,
    metadata?: ApprovalRetentionUpdateMetadata,
  ): ApprovalRetentionStatus {
    const changes: ValidatedApprovalRetentionUpdate = {};

    if (typeof update.maxHistoryCount === "number") {
      this.maxHistoryCount = update.maxHistoryCount;
      changes.maxHistoryCount = update.maxHistoryCount;
    }
    if (typeof update.maxAgeDays === "number") {
      this.maxAgeDays = update.maxAgeDays;
      changes.maxAgeDays = update.maxAgeDays;
    }
    if (typeof update.pruneIntervalMs === "number") {
      this.pruneIntervalMs = update.pruneIntervalMs;
      changes.pruneIntervalMs = update.pruneIntervalMs;
      this.resetPruneTimer();
    }

    this.recordRetentionAudit(changes, metadata);
    this.lastRetentionPolicyUpdateAtMs = Date.now();
    this.pruneHistory();
    void this.persist();
    return this.getRetentionStatus();
  }

  listRetentionAudit(limit = 25): ApprovalRetentionAuditEntry[] {
    const normalizedLimit = Math.max(1, Math.min(limit, 200));
    return this.retentionAuditTrail.slice(0, normalizedLimit);
  }

  consumeApprovedToken(
    taskId: string,
    fromPhase: TaskPhase,
    toPhase: TaskPhase,
    approvalToken?: string,
  ): { ok: boolean; reason?: string } {
    if (!this.requiresApproval(toPhase)) {
      return { ok: true };
    }

    if (!approvalToken) {
      return {
        ok: false,
        reason: "Approval token is required for this transition.",
      };
    }

    const request = this.requests.get(approvalToken);
    if (!request) {
      return { ok: false, reason: "Approval request not found." };
    }

    const matchesTask =
      request.taskId === taskId &&
      request.fromPhase === fromPhase &&
      request.toPhase === toPhase;
    if (!matchesTask) {
      return {
        ok: false,
        reason: "Approval request does not match this transition.",
      };
    }

    if (request.status !== "approved") {
      return { ok: false, reason: "Approval request has not been approved." };
    }

    this.requests.set(approvalToken, {
      ...request,
      consumedAt: new Date().toISOString(),
    });
    void this.persist();
    return { ok: true };
  }

  private requiresApproval(toPhase: TaskPhase): boolean {
    return this.enabled && this.protectedPhases.has(toPhase);
  }

  private pruneHistory(): void {
    const all = Array.from(this.requests.values());
    const pending = all.filter((request) => request.status === "pending");
    const history = all
      .filter((request) => request.status !== "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const nowMs = Date.now();
    const maxAgeMs = this.maxAgeDays * 24 * 60 * 60 * 1000;
    const ageFiltered = history.filter((request) => {
      const timestamp = Date.parse(request.createdAt);
      if (Number.isNaN(timestamp)) {
        return true;
      }
      return nowMs - timestamp <= maxAgeMs;
    });

    const limited = ageFiltered.slice(0, this.maxHistoryCount);
    const keepIds = new Set<string>([
      ...pending.map((request) => request.id),
      ...limited.map((request) => request.id),
    ]);

    let removed = 0;
    for (const request of this.requests.values()) {
      if (!keepIds.has(request.id)) {
        this.requests.delete(request.id);
        removed += 1;
      }
    }

    this.lastPrunedAt = new Date().toISOString();
    this.lastPrunedCount = removed;
    if (removed > 0) {
      void this.persist();
    }
  }

  private parsePositiveInteger(
    raw: string | undefined,
    fallback: number,
  ): number {
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    const normalized = Math.floor(parsed);
    if (normalized <= 0) {
      return fallback;
    }

    return normalized;
  }

  validateRetentionPolicyUpdate(
    update: ApprovalRetentionUpdate,
  ): ValidatedApprovalRetentionUpdate {
    const nowMs = Date.now();
    const remainingCooldownMs =
      this.updateMinIntervalMs - (nowMs - this.lastRetentionPolicyUpdateAtMs);
    if (this.lastRetentionPolicyUpdateAtMs > 0 && remainingCooldownMs > 0) {
      throw new Error(
        `Retention policy updates are rate limited. Retry after ${remainingCooldownMs} ms.`,
      );
    }

    const validated: ValidatedApprovalRetentionUpdate = {};

    if (update.maxHistoryCount !== undefined) {
      if (!this.isValidPositiveInteger(update.maxHistoryCount)) {
        throw new Error("maxHistoryCount must be a positive integer.");
      }
      validated.maxHistoryCount = this.ensureBounded(
        "maxHistoryCount",
        Math.floor(update.maxHistoryCount),
        ApprovalGateService.MIN_HISTORY_COUNT,
        ApprovalGateService.MAX_HISTORY_COUNT,
      );
    }

    if (update.maxAgeDays !== undefined) {
      if (!this.isValidPositiveInteger(update.maxAgeDays)) {
        throw new Error("maxAgeDays must be a positive integer.");
      }
      validated.maxAgeDays = this.ensureBounded(
        "maxAgeDays",
        Math.floor(update.maxAgeDays),
        ApprovalGateService.MIN_MAX_AGE_DAYS,
        ApprovalGateService.MAX_MAX_AGE_DAYS,
      );
    }

    if (update.pruneIntervalMs !== undefined) {
      if (!this.isValidPositiveInteger(update.pruneIntervalMs)) {
        throw new Error("pruneIntervalMs must be a positive integer.");
      }
      validated.pruneIntervalMs = this.ensureBounded(
        "pruneIntervalMs",
        Math.floor(update.pruneIntervalMs),
        ApprovalGateService.MIN_PRUNE_INTERVAL_MS,
        ApprovalGateService.MAX_PRUNE_INTERVAL_MS,
      );
    }

    if (
      validated.maxHistoryCount === undefined &&
      validated.maxAgeDays === undefined &&
      validated.pruneIntervalMs === undefined
    ) {
      throw new Error(
        "At least one retention field must be provided in the update body.",
      );
    }

    return validated;
  }

  private isValidPositiveInteger(value: number): boolean {
    return Number.isFinite(value) && Number.isInteger(value) && value > 0;
  }

  private ensureBounded(
    field: "maxHistoryCount" | "maxAgeDays" | "pruneIntervalMs",
    value: number,
    min: number,
    max: number,
  ): number {
    if (value < min || value > max) {
      throw new Error(`${field} must be between ${min} and ${max}.`);
    }
    return value;
  }

  private clampRange(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private resetPruneTimer(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
    }
    this.pruneTimer = setInterval(() => {
      this.pruneHistory();
    }, this.pruneIntervalMs);
  }

  private recordRetentionAudit(
    changes: ValidatedApprovalRetentionUpdate,
    metadata?: ApprovalRetentionUpdateMetadata,
  ): void {
    const entry: ApprovalRetentionAuditEntry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      actor: metadata?.actor?.trim() || "system",
      source: metadata?.source?.trim() || "runtime-diagnostics-panel",
      changes,
    };
    this.retentionAuditTrail.unshift(entry);
    if (this.retentionAuditTrail.length > this.retentionAuditLimit) {
      this.retentionAuditTrail.length = this.retentionAuditLimit;
    }
  }

  private async persist(): Promise<void> {
    await this.stateStore.setApprovalGateState({
      enabled: this.enabled,
      protectedPhases: Array.from(this.protectedPhases),
      requests: this.listRequests(),
      retentionAudit: this.listRetentionAudit(this.retentionAuditLimit),
    });
  }
}
