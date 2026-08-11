import { API_BASE_URL } from "@src/config";
import { type AgentRole } from "@src/types/agent";

export type { AgentRole };

export type TaskPhase =
  | "todo"
  | "in-progress"
  | "in-review"
  | "testing"
  | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
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

export interface ApprovalGateStatus {
  enabled: boolean;
  protectedPhases: TaskPhase[];
}

export interface ApprovalEvaluation {
  approvalRequired: boolean;
  requestId?: string;
  reason?: string;
}

export interface ApprovalDecision {
  id: string;
  status: string;
}

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

export interface ApprovalRequestPage {
  items: ApprovalRequest[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApprovalRequestQuery {
  taskId?: string;
  status?: "pending" | "approved" | "rejected";
  limit?: number;
  offset?: number;
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
  actor?: string;
  source?: string;
}

export interface ApprovalRetentionAuditEntry {
  id: string;
  createdAt: string;
  actor: string;
  source: string;
  changes: {
    maxHistoryCount?: number;
    maxAgeDays?: number;
    pruneIntervalMs?: number;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const rawMessage = body?.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join("; ")
      : rawMessage;
    throw new Error(message ?? `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function listTasks(): Promise<Task[]> {
  return request<Task[]>("/tasks");
}

export async function upsertTask(task: Task): Promise<Task> {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export async function deleteTask(taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export function createTaskId(): string {
  return `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function moveTask(
  taskId: string,
  phase: TaskPhase,
  approvalToken?: string,
): Promise<Task> {
  return request<Task>(`/tasks/${taskId}/phase`, {
    method: "PATCH",
    body: JSON.stringify({ phase, approvalToken }),
  });
}

export async function restartTask(taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${taskId}/restart`, {
    method: "POST",
  });
}

export async function stopTask(taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${taskId}/stop`, {
    method: "POST",
  });
}

export async function getApprovalGateStatus(): Promise<ApprovalGateStatus> {
  return request<ApprovalGateStatus>("/tasks/approval-gate");
}

export async function setApprovalGateEnabled(
  enabled: boolean,
): Promise<ApprovalGateStatus> {
  return request<ApprovalGateStatus>("/tasks/approval-gate", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function evaluateApproval(
  taskId: string,
  fromPhase: TaskPhase,
  toPhase: TaskPhase,
): Promise<ApprovalEvaluation> {
  return request<ApprovalEvaluation>("/tasks/approval-gate/evaluate", {
    method: "POST",
    body: JSON.stringify({ taskId, fromPhase, toPhase }),
  });
}

export async function decideApproval(
  requestId: string,
  approved: boolean,
): Promise<ApprovalDecision> {
  return request<ApprovalDecision>(
    `/tasks/approval-gate/requests/${requestId}/decision`,
    {
      method: "POST",
      body: JSON.stringify({ approved, actor: "board-ui" }),
    },
  );
}

export async function listApprovalRequests(
  query: ApprovalRequestQuery = {},
): Promise<ApprovalRequestPage> {
  const params = new URLSearchParams();
  if (query.taskId) {
    params.set("taskId", query.taskId);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  if (typeof query.offset === "number") {
    params.set("offset", String(query.offset));
  }

  const suffix = params.toString();
  return request<ApprovalRequestPage>(
    `/tasks/approval-gate/requests${suffix ? `?${suffix}` : ""}`,
  );
}

export async function getApprovalRetentionStatus(): Promise<ApprovalRetentionStatus> {
  return request<ApprovalRetentionStatus>("/tasks/approval-gate/retention");
}

export async function updateApprovalRetentionStatus(
  update: ApprovalRetentionUpdate,
): Promise<ApprovalRetentionStatus> {
  return request<ApprovalRetentionStatus>("/tasks/approval-gate/retention", {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export async function getApprovalRetentionAudit(
  limit = 25,
): Promise<ApprovalRetentionAuditEntry[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  return request<ApprovalRetentionAuditEntry[]>(
    `/tasks/approval-gate/retention/audit?${params.toString()}`,
  );
}
