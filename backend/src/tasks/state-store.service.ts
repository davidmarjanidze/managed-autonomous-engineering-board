import { Injectable } from "@nestjs/common";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  type ApprovalRequest,
  type ApprovalRetentionAuditEntry,
} from "@src/tasks/approval-gate.service";
import { seedTasks } from "@src/tasks/seed-tasks";
import { type Task, type TaskPhase } from "@src/tasks/tasks.service";

interface PersistedApprovalGateState {
  enabled: boolean;
  protectedPhases: TaskPhase[];
  requests: ApprovalRequest[];
  retentionAudit: ApprovalRetentionAuditEntry[];
}

interface PersistedState {
  tasks: Task[];
  approvalGate: PersistedApprovalGateState;
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

@Injectable()
export class StateStoreService {
  private readonly stateDbPath =
    process.env.STATE_DB_PATH ?? join(process.cwd(), "data", "state.db");
  private readonly legacyStatePath =
    process.env.LEGACY_STATE_JSON_PATH ??
    join(process.cwd(), "data", "state.json");

  private db: DatabaseSync | null = null;
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.stateDbPath), { recursive: true });

    this.db = new DatabaseSync(this.stateDbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        phase TEXT NOT NULL,
        screenshot_base64 TEXT,
        session_id TEXT,
        agent_role TEXT,
        agent_status TEXT,
        agent_message TEXT,
        github_pr_url TEXT,
        github_pr_id TEXT,
        worktree_path TEXT,
        worktree_branch TEXT,
        worktree_status TEXT,
        worktree_message TEXT
      );

      CREATE TABLE IF NOT EXISTS approval_gate_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL,
        protected_phases_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        from_phase TEXT NOT NULL,
        to_phase TEXT NOT NULL,
        status TEXT NOT NULL,
        actor TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        consumed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS approval_retention_audit (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        source TEXT NOT NULL,
        changes_json TEXT NOT NULL
      );
    `);

    this.ensureTaskSchemaColumns();
    this.resetSeedTasks();

    this.loaded = true;
    this.seedDefaultApprovalGateIfNeeded();
    await this.importLegacyJsonIfNeeded();
  }

  async getState(): Promise<PersistedState> {
    await this.ensureLoaded();
    const db = this.getDb();

    const taskRows = db
      .prepare(
        `
          SELECT
            id,
            title,
            description,
            phase,
            screenshot_base64,
            session_id,
            agent_role,
            agent_status,
            agent_message,
            github_pr_url,
            github_pr_id,
            worktree_path,
            worktree_branch,
            worktree_status,
            worktree_message
          FROM tasks
        `,
      )
      .all() as Array<{
      id: string;
      title: string;
      description: string | null;
      phase: TaskPhase;
      screenshot_base64: string | null;
      session_id: string | null;
      agent_role: "dev" | "reviewer" | "tester" | null;
      agent_status: "processing" | "failed" | "done" | null;
      agent_message: string | null;
      github_pr_url: string | null;
      github_pr_id: string | null;
      worktree_path: string | null;
      worktree_branch: string | null;
      worktree_status: "ready" | "failed" | null;
      worktree_message: string | null;
    }>;

    const tasks: Task[] = taskRows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      phase: row.phase,
      screenshotBase64: row.screenshot_base64 ?? undefined,
      sessionId: row.session_id ?? undefined,
      agentRole: row.agent_role ?? undefined,
      agentStatus: row.agent_status ?? undefined,
      agentMessage: row.agent_message ?? undefined,
      githubPrUrl: row.github_pr_url ?? undefined,
      githubPrId: row.github_pr_id ?? undefined,
      worktreePath: row.worktree_path ?? undefined,
      worktreeBranch: row.worktree_branch ?? undefined,
      worktreeStatus: row.worktree_status ?? undefined,
      worktreeMessage: row.worktree_message ?? undefined,
    }));

    const gateRow = db
      .prepare(
        `
          SELECT enabled, protected_phases_json
          FROM approval_gate_state
          WHERE id = 1
        `,
      )
      .get() as { enabled: number; protected_phases_json: string } | undefined;

    const requestRows = db
      .prepare(
        `
          SELECT
            id,
            task_id,
            from_phase,
            to_phase,
            status,
            actor,
            note,
            created_at,
            decided_at,
            consumed_at
          FROM approval_requests
        `,
      )
      .all() as Array<{
      id: string;
      task_id: string;
      from_phase: TaskPhase;
      to_phase: TaskPhase;
      status: "pending" | "approved" | "rejected";
      actor: string | null;
      note: string | null;
      created_at: string;
      decided_at: string | null;
      consumed_at: string | null;
    }>;

    const retentionAuditRows = db
      .prepare(
        `
          SELECT
            id,
            created_at,
            actor,
            source,
            changes_json
          FROM approval_retention_audit
          ORDER BY created_at DESC
        `,
      )
      .all() as Array<{
      id: string;
      created_at: string;
      actor: string;
      source: string;
      changes_json: string;
    }>;

    return {
      tasks,
      approvalGate: {
        enabled: gateRow
          ? gateRow.enabled === 1
          : DEFAULT_STATE.approvalGate.enabled,
        protectedPhases: gateRow
          ? this.parseProtectedPhases(gateRow.protected_phases_json)
          : DEFAULT_STATE.approvalGate.protectedPhases,
        requests: requestRows.map((row) => ({
          id: row.id,
          taskId: row.task_id,
          fromPhase: row.from_phase,
          toPhase: row.to_phase,
          status: row.status,
          actor: row.actor ?? undefined,
          note: row.note ?? undefined,
          createdAt: row.created_at,
          decidedAt: row.decided_at ?? undefined,
          consumedAt: row.consumed_at ?? undefined,
        })),
        retentionAudit: retentionAuditRows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          actor: row.actor,
          source: row.source,
          changes: this.parseRetentionChanges(row.changes_json),
        })),
      },
    };
  }

  async setTasks(tasks: Task[]): Promise<void> {
    await this.ensureLoaded();

    const db = this.getDb();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id,
        title,
        description,
        phase,
        screenshot_base64,
        session_id,
        agent_role,
        agent_status,
        agent_message,
        github_pr_url,
        github_pr_id,
        worktree_path,
        worktree_branch,
        worktree_status,
        worktree_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.writeQueue = this.writeQueue.then(async () => {
      this.runInTransaction(() => {
        db.exec("DELETE FROM tasks");
        for (const task of tasks) {
          insert.run(
            task.id,
            task.title,
            task.description ?? null,
            task.phase,
            task.screenshotBase64 ?? null,
            task.sessionId ?? null,
            task.agentRole ?? null,
            task.agentStatus ?? null,
            task.agentMessage ?? null,
            task.githubPrUrl ?? null,
            task.githubPrId ?? null,
            task.worktreePath ?? null,
            task.worktreeBranch ?? null,
            task.worktreeStatus ?? null,
            task.worktreeMessage ?? null,
          );
        }
      });
    });
    await this.persist();
  }

  async setApprovalGateState(state: PersistedApprovalGateState): Promise<void> {
    await this.ensureLoaded();

    const db = this.getDb();
    const upsertGate = db.prepare(`
      INSERT INTO approval_gate_state (id, enabled, protected_phases_json)
      VALUES (1, ?, ?)
      ON CONFLICT(id)
      DO UPDATE SET
        enabled = excluded.enabled,
        protected_phases_json = excluded.protected_phases_json
    `);

    const insertRequest = db.prepare(`
      INSERT OR REPLACE INTO approval_requests (
        id,
        task_id,
        from_phase,
        to_phase,
        status,
        actor,
        note,
        created_at,
        decided_at,
        consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRetentionAudit = db.prepare(`
      INSERT OR REPLACE INTO approval_retention_audit (
        id,
        created_at,
        actor,
        source,
        changes_json
      ) VALUES (?, ?, ?, ?, ?)
    `);

    this.writeQueue = this.writeQueue.then(async () => {
      this.runInTransaction(() => {
        upsertGate.run(
          state.enabled ? 1 : 0,
          JSON.stringify(state.protectedPhases),
        );

        db.exec("DELETE FROM approval_requests");
        for (const request of state.requests) {
          insertRequest.run(
            request.id,
            request.taskId,
            request.fromPhase,
            request.toPhase,
            request.status,
            request.actor ?? null,
            request.note ?? null,
            request.createdAt,
            request.decidedAt ?? null,
            request.consumedAt ?? null,
          );
        }

        db.exec("DELETE FROM approval_retention_audit");
        for (const entry of state.retentionAudit) {
          insertRetentionAudit.run(
            entry.id,
            entry.createdAt,
            entry.actor,
            entry.source,
            JSON.stringify(entry.changes),
          );
        }
      });
    });
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.writeQueue;
  }

  private runInTransaction(action: () => void): void {
    const db = this.getDb();
    db.exec("BEGIN");
    try {
      action();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private seedDefaultApprovalGateIfNeeded(): void {
    const db = this.getDb();
    const existing = db
      .prepare("SELECT id FROM approval_gate_state WHERE id = 1")
      .get() as { id: number } | undefined;
    if (existing) {
      return;
    }

    db.prepare(
      `
        INSERT INTO approval_gate_state (id, enabled, protected_phases_json)
        VALUES (1, ?, ?)
      `,
    ).run(
      DEFAULT_STATE.approvalGate.enabled ? 1 : 0,
      JSON.stringify(DEFAULT_STATE.approvalGate.protectedPhases),
    );
  }

  private ensureTaskSchemaColumns(): void {
    const db = this.getDb();
    const columns = new Set(
      (
        db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>
      ).map((row) => row.name),
    );

    const addColumn = (name: string, sqlType: string): void => {
      if (columns.has(name)) {
        return;
      }
      db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${sqlType}`);
    };

    addColumn("agent_role", "TEXT");
    addColumn("agent_status", "TEXT");
    addColumn("agent_message", "TEXT");
    addColumn("github_pr_url", "TEXT");
    addColumn("github_pr_id", "TEXT");
  }

  private resetSeedTasks(): void {
    const db = this.getDb();
    db.exec("DELETE FROM tasks");

    const insert = db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id,
        title,
        description,
        phase,
        screenshot_base64,
        session_id,
        agent_role,
        agent_status,
        agent_message,
        github_pr_url,
        github_pr_id,
        worktree_path,
        worktree_branch,
        worktree_status,
        worktree_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.runInTransaction(() => {
      for (const task of seedTasks) {
        insert.run(
          task.id,
          task.title,
          task.description ?? null,
          task.phase,
          task.screenshotBase64 ?? null,
          task.sessionId ?? null,
          task.agentRole ?? null,
          task.agentStatus ?? null,
          task.agentMessage ?? null,
          task.githubPrUrl ?? null,
          task.githubPrId ?? null,
          task.worktreePath ?? null,
          task.worktreeBranch ?? null,
          task.worktreeStatus ?? null,
          task.worktreeMessage ?? null,
        );
      }
    });
  }

  private async importLegacyJsonIfNeeded(): Promise<void> {
    const db = this.getDb();
    const hasTasks =
      (
        db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as {
          count: number;
        }
      ).count > 0;
    const hasRequests =
      (
        db.prepare("SELECT COUNT(*) AS count FROM approval_requests").get() as {
          count: number;
        }
      ).count > 0;

    if (hasTasks || hasRequests || !existsSync(this.legacyStatePath)) {
      return;
    }

    try {
      const raw = await readFile(this.legacyStatePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;

      await this.setTasks(parsed.tasks ?? []);
      await this.setApprovalGateState({
        enabled: parsed.approvalGate?.enabled ?? true,
        protectedPhases: parsed.approvalGate?.protectedPhases ?? [
          "testing",
          "done",
        ],
        requests: parsed.approvalGate?.requests ?? [],
        retentionAudit: parsed.approvalGate?.retentionAudit ?? [],
      });
    } catch {
      // Ignore malformed legacy snapshots and continue with empty defaults.
    }
  }

  private parseProtectedPhases(json: string): TaskPhase[] {
    try {
      const parsed = JSON.parse(json) as TaskPhase[];
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fallback handled below.
    }
    return DEFAULT_STATE.approvalGate.protectedPhases;
  }

  private parseRetentionChanges(
    json: string,
  ): ApprovalRetentionAuditEntry["changes"] {
    try {
      const parsed = JSON.parse(json) as ApprovalRetentionAuditEntry["changes"];
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Fallback handled below.
    }

    return {};
  }

  private getDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("State database has not been initialized.");
    }
    return this.db;
  }
}
