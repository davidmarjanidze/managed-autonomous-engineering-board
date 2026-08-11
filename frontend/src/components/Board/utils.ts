import type { ApprovalRequest, Task, TaskPhase } from "@src/services/tasks";

export function formatRelativeAge(ageMs: number): string {
  if (ageMs < 10_000) {
    return "updated just now";
  }

  const totalSeconds = Math.floor(ageMs / 1000);
  if (totalSeconds < 60) {
    return `updated ${totalSeconds}s ago`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `updated ${totalMinutes}m ago`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  return `updated ${totalHours}h ago`;
}

export function groupRequestsByTask(
  requests: ApprovalRequest[],
): Record<string, ApprovalRequest[]> {
  const grouped: Record<string, ApprovalRequest[]> = {};
  for (const request of requests) {
    if (!grouped[request.taskId]) {
      grouped[request.taskId] = [];
    }
    grouped[request.taskId].push(request);
  }
  return grouped;
}

export function groupTasksByPhase(
  tasks: Task[],
  orderedPhases: TaskPhase[],
): Record<TaskPhase, Task[]> {
  return orderedPhases.reduce<Record<TaskPhase, Task[]>>(
    (acc, phase) => {
      acc[phase] = tasks.filter((task: Task) => task.phase === phase);
      return acc;
    },
    {
      todo: [],
      "in-progress": [],
      "in-review": [],
      testing: [],
      done: [],
    },
  );
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}
