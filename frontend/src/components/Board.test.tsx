// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Board } from "@src/components/Board";
import { getRuntimeHealth } from "@src/services/sessions";
import {
  decideApproval,
  evaluateApproval,
  getApprovalGateStatus,
  listApprovalRequests,
  listTasks,
  moveTask,
  setApprovalGateEnabled,
  upsertTask,
  type ApprovalRequestPage,
  type Task,
} from "@src/services/tasks";

vi.mock("@src/services/tasks", async () => {
  const actual = await vi.importActual<typeof import("@src/services/tasks")>(
    "@src/services/tasks",
  );

  return {
    ...actual,
    listTasks: vi.fn(),
    listApprovalRequests: vi.fn(),
    getApprovalGateStatus: vi.fn(),
    evaluateApproval: vi.fn(),
    decideApproval: vi.fn(),
    moveTask: vi.fn(),
    setApprovalGateEnabled: vi.fn(),
    upsertTask: vi.fn(),
  };
});

vi.mock("@src/services/sessions", () => ({
  getRuntimeHealth: vi.fn(),
}));

vi.mock("@hello-pangea/dnd", () => ({
  DragDropContext: ({ children, onDragEnd }: any) => (
    <div>
      <button
        type="button"
        data-testid="mock-dnd-drop-testing"
        onClick={() =>
          onDragEnd({
            draggableId: "task-1",
            destination: { droppableId: "testing", index: 0 },
          })
        }
      >
        Move task-1 to testing
      </button>
      {children}
    </div>
  ),
  Droppable: ({ children }: any) =>
    children({
      innerRef: () => undefined,
      droppableProps: {},
      placeholder: null,
    }),
  Draggable: ({ children }: any) =>
    children({
      innerRef: () => undefined,
      draggableProps: {},
      dragHandleProps: {},
    }),
}));

const mockedListTasks = vi.mocked(listTasks);
const mockedListApprovalRequests = vi.mocked(listApprovalRequests);
const mockedGetApprovalGateStatus = vi.mocked(getApprovalGateStatus);
const mockedGetRuntimeHealth = vi.mocked(getRuntimeHealth);
const mockedEvaluateApproval = vi.mocked(evaluateApproval);
const mockedDecideApproval = vi.mocked(decideApproval);
const mockedMoveTask = vi.mocked(moveTask);
const mockedSetApprovalGateEnabled = vi.mocked(setApprovalGateEnabled);
const mockedUpsertTask = vi.mocked(upsertTask);

const emptyAuditPage: ApprovalRequestPage = {
  items: [],
  total: 0,
  limit: 25,
  offset: 0,
};

function mockFileReaderWithResult(result: string): () => void {
  const OriginalFileReader = globalThis.FileReader;

  class MockFileReader {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public result: string | null = null;

    readAsDataURL(): void {
      this.result = result;
      if (this.onload) {
        this.onload();
      }
    }
  }

  (globalThis as { FileReader: unknown }).FileReader =
    MockFileReader as unknown;

  return () => {
    (globalThis as { FileReader: typeof OriginalFileReader }).FileReader =
      OriginalFileReader;
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Board approval flow", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockedGetApprovalGateStatus.mockResolvedValue({
      enabled: true,
      protectedPhases: ["testing", "done"],
    });
    mockedListApprovalRequests.mockResolvedValue(emptyAuditPage);
    mockedGetRuntimeHealth.mockResolvedValue({
      runtimeMode: "managed",
      apiKeyConfigured: true,
      betaHeader: "managed-agents-2026-04-01",
      agents: {
        dev: true,
        reviewer: true,
        tester: true,
      },
      capabilities: {
        managedSessionsCreate: true,
        managedSessionsStream: true,
      },
      reasons: [],
      registration: {
        mcpConfigured: false,
        roles: {
          dev: { tools: ["agent_toolset_20260401"], mcpServers: [] },
          reviewer: { tools: ["agent_toolset_20260401"], mcpServers: [] },
          tester: { tools: ["agent_toolset_20260401"], mcpServers: [] },
        },
      },
    });
    mockedSetApprovalGateEnabled.mockResolvedValue({
      enabled: true,
      protectedPhases: ["testing", "done"],
    });
  });

  it("moves task to a protected phase when approval is granted", async () => {
    const existingTasks: Task[] = [
      {
        id: "task-1",
        title: "Security review",
        description: "Review high-risk change",
        phase: "in-review",
      },
    ];
    mockedListTasks.mockResolvedValue(existingTasks);
    mockedEvaluateApproval.mockResolvedValue({
      approvalRequired: true,
      requestId: "req-1",
      reason: "Approval required",
    });
    mockedDecideApproval.mockResolvedValue({ id: "req-1", status: "approved" });
    mockedMoveTask.mockResolvedValue({
      ...existingTasks[0],
      phase: "testing",
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Security review");
    fireEvent.click(screen.getByTestId("mock-dnd-drop-testing"));

    await waitFor(() => {
      expect(mockedEvaluateApproval).toHaveBeenCalledWith(
        "task-1",
        "in-review",
        "testing",
      );
    });
    expect(mockedDecideApproval).toHaveBeenCalledWith("req-1", true);
    expect(mockedMoveTask).toHaveBeenCalledWith("task-1", "testing", "req-1");
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });

  it("does not move task when approval is denied", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Security review",
        description: "Review high-risk change",
        phase: "in-review",
      },
    ]);
    mockedEvaluateApproval.mockResolvedValue({
      approvalRequired: true,
      requestId: "req-2",
      reason: "Approval required",
    });
    mockedDecideApproval.mockResolvedValue({ id: "req-2", status: "rejected" });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Security review");
    fireEvent.click(screen.getByTestId("mock-dnd-drop-testing"));

    await screen.findByText("Transition cancelled: approval was not granted.");
    expect(mockedMoveTask).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("shows validation error when creating a task without a title", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Existing task",
        description: "Existing description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Existing task");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Task title is required.");
    expect(mockedUpsertTask).not.toHaveBeenCalled();
  });

  it("creates a new task and persists it through upsert", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Existing task",
        description: "Existing description",
        phase: "todo",
      },
    ]);
    mockedUpsertTask.mockImplementation(async (task) => task);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Existing task");
    fireEvent.change(screen.getByPlaceholderText("Add a task title"), {
      target: { value: "New task" },
    });
    fireEvent.change(screen.getByPlaceholderText("Add task details"), {
      target: { value: "Details for new task" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockedUpsertTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "New task",
          description: "Details for new task",
          phase: "todo",
        }),
      );
    });
    await screen.findByText("New task");
  });

  it("edits an existing task and persists updates through upsert", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Editable task",
        description: "Old description",
        phase: "todo",
      },
    ]);
    mockedUpsertTask.mockImplementation(async (task) => task);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Editable task");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const titleInput = screen.getByDisplayValue("Editable task");
    const descriptionInput = screen.getByDisplayValue("Old description");

    fireEvent.change(titleInput, {
      target: { value: "Edited task title" },
    });
    fireEvent.change(descriptionInput, {
      target: { value: "Edited description" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedUpsertTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task-1",
          title: "Edited task title",
          description: "Edited description",
        }),
      );
    });
    await screen.findByText("Edited task title");
  });

  it("applies approval-audit status filter and reloads audit page", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Filter task",
        description: "Filter description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Filter task");
    fireEvent.change(screen.getByLabelText("Approval Audit Status"), {
      target: { value: "pending" },
    });

    await waitFor(() => {
      expect(mockedListApprovalRequests).toHaveBeenLastCalledWith({
        status: "pending",
        limit: 25,
        offset: 0,
      });
    });
  });

  it("loads next approval-audit page when pagination next is clicked", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Pagination task",
        description: "Pagination description",
        phase: "todo",
      },
    ]);
    mockedListApprovalRequests.mockReset();
    mockedListApprovalRequests
      .mockResolvedValueOnce({
        items: [],
        total: 50,
        limit: 25,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [],
        total: 50,
        limit: 25,
        offset: 25,
      });

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Pagination task");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockedListApprovalRequests).toHaveBeenLastCalledWith({
        status: undefined,
        limit: 25,
        offset: 25,
      });
    });
  });

  it("persists approval-gate toggle successfully", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Toggle task",
        description: "Toggle description",
        phase: "todo",
      },
    ]);
    mockedSetApprovalGateEnabled.mockResolvedValue({
      enabled: false,
      protectedPhases: ["testing", "done"],
    });

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Toggle task");
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(mockedSetApprovalGateEnabled).toHaveBeenCalledWith(false);
    });
    expect(checkbox.checked).toBe(false);
  });

  it("reverts approval-gate toggle and shows error on persistence failure", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Toggle failure task",
        description: "Toggle failure description",
        phase: "todo",
      },
    ]);
    mockedSetApprovalGateEnabled.mockRejectedValue(new Error("toggle failed"));

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Toggle failure task");
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);

    await screen.findByText("Failed to update approval gate settings.");
    expect(checkbox.checked).toBe(true);
  });

  it("includes uploaded screenshot when creating a task", async () => {
    const restoreFileReader = mockFileReaderWithResult(
      "data:image/png;base64,CREATE",
    );
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Image task",
        description: "Image description",
        phase: "todo",
      },
    ]);
    mockedUpsertTask.mockImplementation(async (task) => task);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Image task");
    fireEvent.change(screen.getByPlaceholderText("Add a task title"), {
      target: { value: "Task with screenshot" },
    });
    fireEvent.change(screen.getByPlaceholderText("Add task details"), {
      target: { value: "Has image" },
    });

    const createPanel = screen
      .getByRole("heading", { name: "Create Task" })
      .closest("div") as HTMLElement;
    const createScreenshotInput =
      within(createPanel).getByLabelText("Screenshot");
    const file = new File(["img"], "shot.png", { type: "image/png" });
    fireEvent.change(createScreenshotInput, {
      target: { files: [file] },
    });

    await screen.findByAltText("New task screenshot preview");
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockedUpsertTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Task with screenshot",
          screenshotBase64: "data:image/png;base64,CREATE",
        }),
      );
    });

    restoreFileReader();
  });

  it("includes uploaded screenshot when editing a task", async () => {
    const restoreFileReader = mockFileReaderWithResult(
      "data:image/png;base64,EDIT",
    );
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Editable image task",
        description: "Needs screenshot",
        phase: "todo",
        screenshotBase64: "data:image/png;base64,OLD",
      },
    ]);
    mockedUpsertTask.mockImplementation(async (task) => task);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Editable image task");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const titleInput = screen.getByDisplayValue("Editable image task");
    const editingCard = titleInput.closest("article") as HTMLElement;

    const editScreenshotInput =
      within(editingCard).getByLabelText("Screenshot");
    const file = new File(["img"], "edit-shot.png", { type: "image/png" });
    fireEvent.change(editScreenshotInput, {
      target: { files: [file] },
    });

    await screen.findByAltText("Task screenshot preview");
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedUpsertTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task-1",
          screenshotBase64: "data:image/png;base64,EDIT",
        }),
      );
    });

    restoreFileReader();
  });

  it("removes existing screenshot when editing a task", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Editable image task",
        description: "Needs screenshot",
        phase: "todo",
        screenshotBase64: "data:image/png;base64,OLD",
      },
    ]);
    mockedUpsertTask.mockImplementation(async (task) => task);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Editable image task");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await screen.findByAltText("Task screenshot preview");
    fireEvent.click(screen.getByRole("button", { name: "Remove screenshot" }));

    await waitFor(() => {
      expect(screen.queryByAltText("Task screenshot preview")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedUpsertTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task-1",
          screenshotBase64: undefined,
        }),
      );
    });
  });

  it("does not persist screenshot changes when edit is canceled", async () => {
    const restoreFileReader = mockFileReaderWithResult(
      "data:image/png;base64,NEW",
    );
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Cancelable image task",
        description: "Initial image",
        phase: "todo",
        screenshotBase64: "data:image/png;base64,OLD",
      },
    ]);
    mockedUpsertTask.mockImplementation(async (task) => task);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Cancelable image task");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const titleInput = screen.getByDisplayValue("Cancelable image task");
    const editingCard = titleInput.closest("article") as HTMLElement;
    const editScreenshotInput =
      within(editingCard).getByLabelText("Screenshot");
    const file = new File(["img"], "replacement.png", { type: "image/png" });

    fireEvent.change(editScreenshotInput, {
      target: { files: [file] },
    });

    await screen.findByAltText("Task screenshot preview");
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedUpsertTask).not.toHaveBeenCalled();
    const persistedScreenshot = screen.getByAltText(
      "Task screenshot",
    ) as HTMLImageElement;
    expect(persistedScreenshot.getAttribute("src")).toBe(
      "data:image/png;base64,OLD",
    );

    restoreFileReader();
  });

  it("shows save error and keeps edit mode open when edit save fails", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Failing edit task",
        description: "Initial description",
        phase: "todo",
      },
    ]);
    mockedUpsertTask.mockRejectedValue(new Error("save failed"));

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Failing edit task");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByDisplayValue("Failing edit task"), {
      target: { value: "Changed title" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Failed to save task.");
    expect(screen.getByDisplayValue("Changed title")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("shows save error and keeps create form values when create fails", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Existing task",
        description: "Existing description",
        phase: "todo",
      },
    ]);
    mockedUpsertTask.mockRejectedValue(new Error("save failed"));

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Existing task");
    fireEvent.change(screen.getByPlaceholderText("Add a task title"), {
      target: { value: "Unpersisted task" },
    });
    fireEvent.change(screen.getByPlaceholderText("Add task details"), {
      target: { value: "Unpersisted details" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Failed to save task.");
    expect(
      (screen.getByPlaceholderText("Add a task title") as HTMLInputElement)
        .value,
    ).toBe("Unpersisted task");
    expect(
      (screen.getByPlaceholderText("Add task details") as HTMLTextAreaElement)
        .value,
    ).toBe("Unpersisted details");
  });

  it("retains create screenshot preview after failed save and reuses it on retry", async () => {
    const restoreFileReader = mockFileReaderWithResult(
      "data:image/png;base64,RETRY",
    );
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Existing task",
        description: "Existing description",
        phase: "todo",
      },
    ]);
    mockedUpsertTask
      .mockRejectedValueOnce(new Error("save failed"))
      .mockImplementationOnce(async (task) => task);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Existing task");
    fireEvent.change(screen.getByPlaceholderText("Add a task title"), {
      target: { value: "Retry task" },
    });
    fireEvent.change(screen.getByPlaceholderText("Add task details"), {
      target: { value: "Retry details" },
    });

    const createPanel = screen
      .getByRole("heading", { name: "Create Task" })
      .closest("div") as HTMLElement;
    const createScreenshotInput =
      within(createPanel).getByLabelText("Screenshot");
    const file = new File(["img"], "retry.png", { type: "image/png" });
    fireEvent.change(createScreenshotInput, {
      target: { files: [file] },
    });

    await screen.findByAltText("New task screenshot preview");
    await flushMicrotasks();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Failed to save task.");
    expect(screen.getByAltText("New task screenshot preview")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockedUpsertTask).toHaveBeenCalledTimes(2);
    });
    expect(mockedUpsertTask).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Retry task",
        description: "Retry details",
        screenshotBase64: "data:image/png;base64,RETRY",
      }),
    );

    expect(
      (screen.getByPlaceholderText("Add a task title") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      (screen.getByPlaceholderText("Add task details") as HTMLTextAreaElement)
        .value,
    ).toBe("");
    expect(screen.queryByAltText("New task screenshot preview")).toBeNull();

    restoreFileReader();
  });

  it("refreshes runtime summary when pressing R on the board container", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    const board = screen.getByLabelText("Task board with keyboard shortcuts");

    const baselineRuntimeCalls = mockedGetRuntimeHealth.mock.calls.length;
    fireEvent.keyDown(board, { key: "r" });

    await waitFor(() => {
      expect(mockedGetRuntimeHealth.mock.calls.length).toBeGreaterThan(
        baselineRuntimeCalls,
      );
    });
  });

  it("changes active phase when pressing Ctrl+ArrowRight", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    const board = screen.getByLabelText("Task board with keyboard shortcuts");

    fireEvent.keyDown(board, { key: "ArrowRight", ctrlKey: true });

    await screen.findByText(/change active phase \(in-progress\)/i);
  });

  it("moves selected task to next phase when pressing Alt+ArrowRight", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);
    mockedMoveTask.mockResolvedValue({
      id: "task-1",
      title: "Keyboard task",
      description: "Keyboard description",
      phase: "in-progress",
    });

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    const selectedTask = screen.getByLabelText(
      "Task Keyboard task in todo phase",
    );
    fireEvent.focus(selectedTask);

    const board = screen.getByLabelText("Task board with keyboard shortcuts");
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });

    await waitFor(() => {
      expect(mockedMoveTask).toHaveBeenCalledWith(
        "task-1",
        "in-progress",
        undefined,
      );
    });
  });

  it("ignores refresh and phase-navigation shortcuts while create form input is focused", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    const titleInput = screen.getByPlaceholderText(
      "Add a task title",
    ) as HTMLInputElement;
    titleInput.focus();

    const baselineRuntimeCalls = mockedGetRuntimeHealth.mock.calls.length;

    fireEvent.keyDown(titleInput, { key: "r" });
    fireEvent.keyDown(titleInput, { key: "ArrowRight", ctrlKey: true });

    expect(mockedGetRuntimeHealth.mock.calls.length).toBe(baselineRuntimeCalls);
    expect(screen.getByText(/change active phase \(todo\)/i)).toBeTruthy();
  });

  it("ignores task movement shortcut while edit form input is focused", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editTitleInput = screen.getByDisplayValue(
      "Keyboard task",
    ) as HTMLInputElement;
    editTitleInput.focus();

    fireEvent.keyDown(editTitleInput, { key: "ArrowRight", altKey: true });

    expect(mockedMoveTask).not.toHaveBeenCalled();
  });

  it("announces runtime refresh shortcut activity via board aria-live text", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    const board = screen.getByLabelText("Task board with keyboard shortcuts");

    expect(screen.getByText("Keyboard shortcuts enabled.")).toBeTruthy();

    fireEvent.keyDown(board, { key: "r" });

    await screen.findByText("Refreshing runtime summary.");
  });

  it("announces phase navigation and task movement via board aria-live text", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);
    mockedMoveTask.mockResolvedValue({
      id: "task-1",
      title: "Keyboard task",
      description: "Keyboard description",
      phase: "in-progress",
    });

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    const board = screen.getByLabelText("Task board with keyboard shortcuts");

    fireEvent.keyDown(board, { key: "ArrowRight", ctrlKey: true });
    await screen.findByText("Phase focus moved to in-progress.");

    const selectedTask = screen.getByLabelText(
      "Task Keyboard task in todo phase",
    );
    fireEvent.focus(selectedTask);
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });

    await waitFor(() => {
      expect(mockedMoveTask).toHaveBeenCalledWith(
        "task-1",
        "in-progress",
        undefined,
      );
    });
    await screen.findByText("Moved task to in-progress.");
  });

  it("announces missing selected-task boundary when task-move shortcut is used without selection", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    const board = screen.getByLabelText("Task board with keyboard shortcuts");

    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });

    await screen.findByText("Select a task card first to move it by keyboard.");
    expect(mockedMoveTask).not.toHaveBeenCalled();
  });

  it("announces first-phase boundary when moving selected task left from first phase", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Keyboard task",
        description: "Keyboard description",
        phase: "todo",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Keyboard task");
    const selectedTask = screen.getByLabelText(
      "Task Keyboard task in todo phase",
    );
    fireEvent.focus(selectedTask);

    const board = screen.getByLabelText("Task board with keyboard shortcuts");
    fireEvent.keyDown(board, { key: "ArrowLeft", altKey: true });

    await screen.findByText("Task is already in the first phase.");
    expect(mockedMoveTask).not.toHaveBeenCalled();
  });

  it("announces final-phase boundary when moving selected task right from final phase", async () => {
    mockedListTasks.mockResolvedValue([
      {
        id: "task-1",
        title: "Final task",
        description: "Final description",
        phase: "done",
      },
    ]);

    render(<Board onInspectSession={() => undefined} />);

    await screen.findByText("Final task");
    const selectedTask = screen.getByLabelText("Task Final task in done phase");
    fireEvent.focus(selectedTask);

    const board = screen.getByLabelText("Task board with keyboard shortcuts");
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });

    await screen.findByText("Task is already in the final phase.");
    expect(mockedMoveTask).not.toHaveBeenCalled();
  });
});
