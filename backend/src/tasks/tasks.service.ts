import { Injectable, OnModuleInit } from "@nestjs/common";

import { StateStoreService } from "@src/tasks/state-store.service";

export type TaskPhase =
  | "todo"
  | "in-progress"
  | "in-review"
  | "testing"
  | "done";

import { type ManagedAgentRole } from "@src/agents/agent-registration-options";

export type TaskAgentRole = ManagedAgentRole;

export type TaskAgentStatus = "processing" | "failed" | "done";

export interface Task {
  id: string;
  title: string;
  description?: string;
  phase: TaskPhase;
  screenshotBase64?: string;
  sessionId?: string;
  agentRole?: TaskAgentRole;
  agentStatus?: TaskAgentStatus;
  agentMessage?: string;
  githubPrUrl?: string;
  githubPrId?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeStatus?: "ready" | "failed";
  worktreeMessage?: string;
}

@Injectable()
export class TasksService implements OnModuleInit {
  private readonly tasks = new Map<string, Task>();

  constructor(private readonly stateStore: StateStoreService) {}

  async onModuleInit(): Promise<void> {
    const persisted = await this.stateStore.getState();
    this.tasks.clear();
    for (const task of persisted.tasks) {
      this.tasks.set(task.id, task);
    }
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  list(): Task[] {
    return Array.from(this.tasks.values());
  }

  upsert(task: Task): Task {
    this.tasks.set(task.id, task);
    void this.persist();
    return task;
  }

  delete(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    this.tasks.delete(taskId);
    void this.persist();
    return task;
  }

  move(taskId: string, phase: TaskPhase): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    const updated: Task = { ...task, phase };
    this.tasks.set(taskId, updated);
    void this.persist();
    return updated;
  }

  attachSession(taskId: string, sessionId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    const updated: Task = { ...task, sessionId };
    this.tasks.set(taskId, updated);
    void this.persist();
    return updated;
  }

  updateAgentState(
    taskId: string,
    updates: {
      agentRole?: TaskAgentRole;
      agentStatus?: TaskAgentStatus;
      agentMessage?: string;
      githubPrUrl?: string;
      githubPrId?: string;
      sessionId?: string;
    },
  ): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    const updated: Task = {
      ...task,
      ...updates,
    };
    this.tasks.set(taskId, updated);
    void this.persist();
    return updated;
  }

  clearAgentState(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    const updated: Task = {
      ...task,
      sessionId: undefined,
      agentRole: undefined,
      agentStatus: undefined,
      agentMessage: undefined,
    };
    this.tasks.set(taskId, updated);
    void this.persist();
    return updated;
  }

  attachWorktree(
    taskId: string,
    details: {
      worktreePath: string;
      worktreeBranch: string;
      worktreeStatus: "ready" | "failed";
      worktreeMessage?: string;
    },
  ): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      return undefined;
    }

    const updated: Task = {
      ...task,
      worktreePath: details.worktreePath,
      worktreeBranch: details.worktreeBranch,
      worktreeStatus: details.worktreeStatus,
      worktreeMessage: details.worktreeMessage,
    };
    this.tasks.set(taskId, updated);
    void this.persist();
    return updated;
  }

  canDelete(taskId: string): boolean {
    return this.tasks.get(taskId)?.agentStatus !== "processing";
  }

  private async persist(): Promise<void> {
    await this.stateStore.setTasks(this.list());
  }
}
