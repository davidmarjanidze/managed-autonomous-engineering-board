import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { useState } from "react";

import { useBoardData } from "@src/components/Board/hooks/useBoardData";
import { readFileAsDataUrl } from "@src/components/Board/utils";
import { TaskCard } from "@src/components/TaskCard";
import { createTaskId, type Task, type TaskPhase } from "@src/services/tasks";

const phaseLabels: Record<TaskPhase, string> = {
  todo: "Backlog",
  "in-progress": "In Progress",
  "in-review": "Review",
  testing: "Testing",
  done: "Done",
};

const visiblePhases: TaskPhase[] = [
  "todo",
  "in-progress",
  "in-review",
  "testing",
  "done",
];

const phaseToneClasses: Record<TaskPhase, string> = {
  todo: "phase-dot phase-dot-todo",
  "in-progress": "phase-dot phase-dot-in-progress",
  "in-review": "phase-dot phase-dot-in-review",
  testing: "phase-dot phase-dot-testing",
  done: "phase-dot phase-dot-done",
};

export interface BoardProps {
  onInspectSession?: (sessionId: string | null) => void;
}

type TaskModalMode = "create" | "edit";

interface TaskDraft {
  id: string;
  title: string;
  description: string;
  phase: TaskPhase;
  screenshotBase64?: string;
}

export function Board(props: BoardProps): React.JSX.Element {
  const { onInspectSession } = props;
  const {
    tasks,
    grouped,
    error,
    approvalAuditByTask,
    saveTask,
    deleteTaskById,
    moveTaskToPhase,
    restartTaskById,
    stopTaskById,
  } = useBoardData({ onRuntimeBootstrap: () => undefined });

  const [taskModalMode, setTaskModalMode] = useState<TaskModalMode | null>(
    null,
  );
  const [taskModalDraft, setTaskModalDraft] = useState<TaskDraft>({
    id: "",
    title: "",
    description: "",
    phase: "todo",
  });
  const [taskModalBusy, setTaskModalBusy] = useState(false);
  const [taskModalError, setTaskModalError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Task | null>(null);

  const onDragEnd = (result: DropResult): void => {
    if (!result.destination) {
      return;
    }

    const taskId = result.draggableId;
    const phase = result.destination.droppableId as TaskPhase;
    void moveTaskToPhase(taskId, phase);
  };

  const onBoardKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      openCreateTaskModal();
    }
  };

  const openCreateTaskModal = (): void => {
    setTaskModalError(null);
    setTaskModalMode("create");
    setTaskModalDraft({
      id: createTaskId(),
      title: "",
      description: "",
      phase: "todo",
    });
  };

  const openEditTaskModal = (task: Task): void => {
    setTaskModalError(null);
    setTaskModalMode("edit");
    setTaskModalDraft({
      id: task.id,
      title: task.title,
      description: task.description,
      phase: task.phase,
      screenshotBase64: task.screenshotBase64,
    });
  };

  const closeTaskModal = (): void => {
    if (taskModalBusy) {
      return;
    }

    setTaskModalMode(null);
    setTaskModalError(null);
  };

  const onTaskDraftImageChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setTaskModalDraft((current) => ({
      ...current,
      screenshotBase64: dataUrl,
    }));
  };

  const saveTaskFromModal = async (): Promise<void> => {
    if (!taskModalDraft.title.trim()) {
      setTaskModalError("Task title is required.");
      return;
    }

    setTaskModalBusy(true);
    setTaskModalError(null);
    try {
      if (taskModalMode === "edit") {
        const existing = tasks.find((task) => task.id === taskModalDraft.id);
        if (!existing) {
          setTaskModalError("Task no longer exists.");
          return;
        }

        await saveTask({
          ...existing,
          title: taskModalDraft.title.trim(),
          description: taskModalDraft.description.trim(),
          phase: taskModalDraft.phase,
          screenshotBase64: taskModalDraft.screenshotBase64,
        });
      } else {
        await saveTask({
          id: taskModalDraft.id,
          title: taskModalDraft.title.trim(),
          description: taskModalDraft.description.trim(),
          phase: taskModalDraft.phase,
          screenshotBase64: taskModalDraft.screenshotBase64,
        });
      }

      setTaskModalMode(null);
    } catch {
      setTaskModalError("Failed to save task. Please retry.");
    } finally {
      setTaskModalBusy(false);
    }
  };

  const confirmDeleteTask = async (): Promise<void> => {
    if (!deleteCandidate) {
      return;
    }

    setTaskModalBusy(true);
    try {
      await deleteTaskById(deleteCandidate.id);
      setDeleteCandidate(null);
    } finally {
      setTaskModalBusy(false);
    }
  };

  return (
    <section
      className="board-shell"
      tabIndex={0}
      onKeyDown={onBoardKeyDown}
      aria-label="Task board with keyboard shortcuts"
    >
      {error ? <p>{error}</p> : null}

      <header className="board-header">
        <h2>Development Board</h2>
        <p>
          Managed Agents - Drag a ticket to 'In Progress' to launch an agent
        </p>
      </header>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="board-grid">
          {visiblePhases.map((phase) => (
            <Droppable key={phase} droppableId={phase}>
              {(provided: any) => (
                <div
                  className="column"
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  onDoubleClick={() => openCreateTaskModal()}
                >
                  <div className="column-heading">
                    <h3>
                      <span
                        className={phaseToneClasses[phase]}
                        aria-hidden="true"
                      />
                      {phaseLabels[phase]}
                    </h3>
                    <span className="column-count">
                      {grouped[phase].length}
                    </span>
                  </div>
                  {grouped[phase].map((task: Task, index: number) => (
                    <Draggable
                      key={task.id}
                      draggableId={task.id}
                      index={index}
                      isDragDisabled={
                        task.agentStatus === "processing" ||
                        task.agentStatus === "failed"
                      }
                    >
                      {(draggableProvided: any) => (
                        <div
                          className="board-task-wrapper"
                          tabIndex={0}
                          aria-label={`Task ${task.title} in ${task.phase} phase`}
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          {...draggableProvided.dragHandleProps}
                        >
                          <TaskCard
                            task={task}
                            onManage={openEditTaskModal}
                            onInspectSession={onInspectSession}
                            onRestartAgent={(taskId) =>
                              void restartTaskById(taskId)
                            }
                            onStopAgent={(taskId) => void stopTaskById(taskId)}
                            approvalRequests={
                              approvalAuditByTask[task.id] ?? []
                            }
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {grouped[phase].length === 0 ? (
                    <div className="column-empty">No tasks</div>
                  ) : null}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      {taskModalMode ? (
        <div
          className="task-modal-backdrop"
          role="presentation"
          onClick={closeTaskModal}
        >
          <section
            className="task-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              taskModalMode === "create" ? "Add new task" : "Edit task"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{taskModalMode === "create" ? "Add New Task" : "Edit Task"}</h3>
            {taskModalError ? (
              <p className="task-modal-error">{taskModalError}</p>
            ) : null}
            <label>
              Title
              <input
                value={taskModalDraft.title}
                onChange={(event) =>
                  setTaskModalDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Task title"
              />
            </label>
            <label>
              Description
              <textarea
                value={taskModalDraft.description}
                onChange={(event) =>
                  setTaskModalDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Task details"
              />
            </label>
            <label>
              Phase
              <select
                value={taskModalDraft.phase}
                onChange={(event) =>
                  setTaskModalDraft((current) => ({
                    ...current,
                    phase: event.target.value as TaskPhase,
                  }))
                }
              >
                {visiblePhases.map((phase) => (
                  <option key={phase} value={phase}>
                    {phaseLabels[phase]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Screenshot
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) => void onTaskDraftImageChange(event)}
              />
            </label>
            {taskModalDraft.screenshotBase64 ? (
              <img
                className="task-image-preview"
                src={taskModalDraft.screenshotBase64}
                alt="Task modal screenshot preview"
              />
            ) : null}
            <div className="task-modal-actions">
              <button
                type="button"
                onClick={() =>
                  setTaskModalDraft((current) => ({
                    ...current,
                    screenshotBase64: undefined,
                  }))
                }
              >
                Remove screenshot
              </button>
              <button
                type="button"
                onClick={() => void saveTaskFromModal()}
                disabled={taskModalBusy}
              >
                {taskModalBusy ? "Saving..." : "Save"}
              </button>
              {taskModalMode === "edit" ? (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    setDeleteCandidate(
                      tasks.find((task) => task.id === taskModalDraft.id) ??
                        null,
                    )
                  }
                  disabled={
                    taskModalBusy ||
                    tasks.find((task) => task.id === taskModalDraft.id)
                      ?.agentStatus === "processing"
                  }
                >
                  Delete
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeTaskModal}
                disabled={taskModalBusy}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div
          className="task-modal-backdrop"
          role="presentation"
          onClick={() => setDeleteCandidate(null)}
        >
          <section
            className="task-modal task-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Delete task confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Delete Task</h3>
            <p>
              Delete <strong>{deleteCandidate.title}</strong>? This cannot be
              undone.
            </p>
            <div className="task-modal-actions">
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                disabled={taskModalBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void confirmDeleteTask()}
                disabled={taskModalBusy}
              >
                {taskModalBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
