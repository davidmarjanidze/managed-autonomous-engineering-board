import { useEffect, useMemo, useState, type ChangeEvent } from "react";

import { phases } from "@src/components/Board/constants";
import {
  groupRequestsByTask,
  groupTasksByPhase,
  readFileAsDataUrl,
} from "@src/components/Board/utils";
import { getRuntimeHealth, type RuntimeHealth } from "@src/services/sessions";
import {
  createTaskId,
  decideApproval,
  deleteTask,
  evaluateApproval,
  getApprovalGateStatus,
  listApprovalRequests,
  listTasks,
  moveTask,
  restartTask,
  setApprovalGateEnabled,
  stopTask,
  upsertTask,
  type ApprovalGateStatus,
  type ApprovalRequest,
  type ApprovalRequestPage,
  type Task,
  type TaskPhase,
} from "@src/services/tasks";

export interface UseBoardDataOptions {
  onRuntimeBootstrap: (runtime: RuntimeHealth | null) => void;
}

export interface UseBoardDataResult {
  tasks: Task[];
  grouped: Record<TaskPhase, Task[]>;
  error: string | null;
  newTaskTitle: string;
  newTaskDescription: string;
  newTaskImage?: string;
  approvalGate: ApprovalGateStatus;
  approvalAuditByTask: Record<string, ApprovalRequest[]>;
  approvalAuditStatusFilter: "all" | "pending" | "approved" | "rejected";
  approvalAuditPage: ApprovalRequestPage;
  setNewTaskTitle: (value: string) => void;
  setNewTaskDescription: (value: string) => void;
  onApprovalFilterChange: (
    event: ChangeEvent<HTMLSelectElement>,
  ) => Promise<void>;
  changeAuditPage: (nextOffset: number) => Promise<void>;
  onApprovalGateToggle: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  saveTask: (updatedTask: Task) => Promise<void>;
  createTask: () => Promise<void>;
  deleteTaskById: (taskId: string) => Promise<void>;
  onNewTaskImageChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  moveTaskToPhase: (taskId: string, phase: TaskPhase) => Promise<void>;
  restartTaskById: (taskId: string) => Promise<void>;
  stopTaskById: (taskId: string) => Promise<void>;
}

export function useBoardData({
  onRuntimeBootstrap,
}: UseBoardDataOptions): UseBoardDataResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskImage, setNewTaskImage] = useState<string | undefined>();
  const [approvalGate, setApprovalGate] = useState<ApprovalGateStatus>({
    enabled: true,
    protectedPhases: ["testing", "done"],
  });
  const [approvalAuditByTask, setApprovalAuditByTask] = useState<
    Record<string, ApprovalRequest[]>
  >({});
  const [approvalAuditStatusFilter, setApprovalAuditStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");
  const [approvalAuditPage, setApprovalAuditPage] =
    useState<ApprovalRequestPage>({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });

  useEffect(() => {
    async function initialize(): Promise<void> {
      try {
        const gate = await getApprovalGateStatus();
        setApprovalGate(gate);

        const [existing, audit, runtimeResult] = await Promise.all([
          listTasks(),
          listApprovalRequests({ limit: 25, offset: 0 }),
          getRuntimeHealth().catch(() => null),
        ]);
        setApprovalAuditPage(audit);
        setApprovalAuditByTask(groupRequestsByTask(audit.items));
        onRuntimeBootstrap(runtimeResult);

        // Backend reseeds on every restart, so always load from server
        setTasks(existing);
      } catch {
        setError("Backend unavailable. Using local board state.");
      }
    }

    void initialize();
  }, [onRuntimeBootstrap]);

  const grouped = useMemo(() => groupTasksByPhase(tasks, phases), [tasks]);

  const refreshApprovalAudit = async (): Promise<void> => {
    try {
      const page = await listApprovalRequests({
        status:
          approvalAuditStatusFilter === "all"
            ? undefined
            : approvalAuditStatusFilter,
        limit: approvalAuditPage.limit,
        offset: approvalAuditPage.offset,
      });
      setApprovalAuditPage(page);
      setApprovalAuditByTask(groupRequestsByTask(page.items));
    } catch {
      setError("Failed to refresh approval audit history.");
    }
  };

  const moveTaskToPhase = async (
    taskId: string,
    phase: TaskPhase,
  ): Promise<void> => {
    try {
      const currentTask = tasks.find((task: Task) => task.id === taskId);
      if (!currentTask) {
        setError("Task not found in current board state.");
        return;
      }

      if (currentTask.agentStatus === "processing") {
        setError("This task is currently processing and cannot be moved.");
        return;
      }

      if (currentTask.agentStatus === "failed") {
        setError("Restart the failed agent before moving this task.");
        return;
      }

      let approvalToken: string | undefined;
      if (
        approvalGate.enabled &&
        approvalGate.protectedPhases.includes(phase)
      ) {
        const evaluation = await evaluateApproval(
          taskId,
          currentTask.phase,
          phase,
        );
        if (evaluation.approvalRequired && evaluation.requestId) {
          const approved = window.confirm(
            evaluation.reason ??
              "This transition requires approval. Approve and continue?",
          );
          await decideApproval(evaluation.requestId, approved);
          await refreshApprovalAudit();

          if (!approved) {
            setError("Transition cancelled: approval was not granted.");
            return;
          }

          approvalToken = evaluation.requestId;
        }
      }

      const updated = await moveTask(taskId, phase, approvalToken);
      setTasks((current: Task[]) =>
        current.map((task: Task) => (task.id === taskId ? updated : task)),
      );
      await refreshApprovalAudit();
      setError(null);
    } catch {
      setError("Failed to persist task movement to backend.");
    }
  };

  const onApprovalFilterChange = async (
    event: ChangeEvent<HTMLSelectElement>,
  ): Promise<void> => {
    const selected = event.target.value as
      | "all"
      | "pending"
      | "approved"
      | "rejected";
    setApprovalAuditStatusFilter(selected);

    try {
      const page = await listApprovalRequests({
        status: selected === "all" ? undefined : selected,
        limit: approvalAuditPage.limit,
        offset: 0,
      });
      setApprovalAuditPage(page);
      setApprovalAuditByTask(groupRequestsByTask(page.items));
      setError(null);
    } catch {
      setError("Failed to apply approval audit filter.");
    }
  };

  const changeAuditPage = async (nextOffset: number): Promise<void> => {
    try {
      const page = await listApprovalRequests({
        status:
          approvalAuditStatusFilter === "all"
            ? undefined
            : approvalAuditStatusFilter,
        limit: approvalAuditPage.limit,
        offset: Math.max(0, nextOffset),
      });
      setApprovalAuditPage(page);
      setApprovalAuditByTask(groupRequestsByTask(page.items));
      setError(null);
    } catch {
      setError("Failed to change approval audit page.");
    }
  };

  const onApprovalGateToggle = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const enabled = event.target.checked;
    const previousEnabled = approvalGate.enabled;
    setApprovalGate((current: ApprovalGateStatus) => ({ ...current, enabled }));

    try {
      const updated = await setApprovalGateEnabled(enabled);
      setApprovalGate(updated);
      setError(null);
    } catch {
      setApprovalGate((current: ApprovalGateStatus) => ({
        ...current,
        enabled: previousEnabled,
      }));
      setError("Failed to update approval gate settings.");
    }
  };

  const saveTask = async (updatedTask: Task): Promise<void> => {
    try {
      const savedTask = await upsertTask(updatedTask);
      setTasks((current: Task[]) => {
        const exists = current.some((task: Task) => task.id === savedTask.id);
        if (!exists) {
          return [...current, savedTask];
        }

        return current.map((task: Task) =>
          task.id === savedTask.id ? savedTask : task,
        );
      });
      setError(null);
    } catch {
      setError("Failed to save task.");
      throw new Error("Failed to save task.");
    }
  };

  const createTask = async (): Promise<void> => {
    if (!newTaskTitle.trim()) {
      setError("Task title is required.");
      return;
    }

    const task: Task = {
      id: createTaskId(),
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim(),
      phase: "todo",
      screenshotBase64: newTaskImage,
    };

    try {
      await saveTask(task);
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskImage(undefined);
    } catch {
      // Keep form state intact so users can correct and retry.
    }
  };

  const deleteTaskById = async (taskId: string): Promise<void> => {
    try {
      await deleteTask(taskId);
      setTasks((current: Task[]) =>
        current.filter((task: Task) => task.id !== taskId),
      );
      setError(null);
    } catch {
      setError("Failed to delete task.");
      throw new Error("Failed to delete task.");
    }
  };

  const restartTaskById = async (taskId: string): Promise<void> => {
    try {
      const updated = await restartTask(taskId);
      setTasks((current: Task[]) =>
        current.map((task: Task) => (task.id === taskId ? updated : task)),
      );
      setError(null);
    } catch {
      setError("Failed to restart agent.");
    }
  };

  const stopTaskById = async (taskId: string): Promise<void> => {
    try {
      const updated = await stopTask(taskId);
      setTasks((current: Task[]) =>
        current.map((task: Task) => (task.id === taskId ? updated : task)),
      );
      setError(null);
    } catch {
      setError("Failed to stop agent.");
    }
  };

  const onNewTaskImageChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setNewTaskImage(dataUrl);
  };

  return {
    tasks,
    grouped,
    error,
    newTaskTitle,
    newTaskDescription,
    newTaskImage,
    approvalGate,
    approvalAuditByTask,
    approvalAuditStatusFilter,
    approvalAuditPage,
    setNewTaskTitle,
    setNewTaskDescription,
    onApprovalFilterChange,
    changeAuditPage,
    onApprovalGateToggle,
    saveTask,
    createTask,
    deleteTaskById,
    onNewTaskImageChange,
    moveTaskToPhase,
    restartTaskById,
    stopTaskById,
  };
}
