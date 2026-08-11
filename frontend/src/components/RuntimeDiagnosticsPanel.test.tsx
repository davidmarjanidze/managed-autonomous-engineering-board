// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeDiagnosticsPanel } from "@src/components/RuntimeDiagnosticsPanel";
import { getRuntimeHealth } from "@src/services/sessions";
import {
  getApprovalRetentionAudit,
  getApprovalRetentionStatus,
  updateApprovalRetentionStatus,
} from "@src/services/tasks";

vi.mock("@src/services/sessions", () => ({
  getRuntimeHealth: vi.fn(),
}));

vi.mock("@src/services/tasks", async () => {
  const actual = await vi.importActual<typeof import("@src/services/tasks")>(
    "@src/services/tasks",
  );

  return {
    ...actual,
    getApprovalRetentionStatus: vi.fn(),
    getApprovalRetentionAudit: vi.fn(),
    updateApprovalRetentionStatus: vi.fn(),
  };
});

const mockedGetRuntimeHealth = vi.mocked(getRuntimeHealth);
const mockedGetApprovalRetentionStatus = vi.mocked(getApprovalRetentionStatus);
const mockedGetApprovalRetentionAudit = vi.mocked(getApprovalRetentionAudit);
const mockedUpdateApprovalRetentionStatus = vi.mocked(
  updateApprovalRetentionStatus,
);

describe("RuntimeDiagnosticsPanel keyboard shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
        mcpConfigured: true,
        roles: {
          dev: { tools: ["agent_toolset_20260401"], mcpServers: ["github"] },
          reviewer: {
            tools: ["agent_toolset_20260401"],
            mcpServers: ["github"],
          },
          tester: { tools: ["agent_toolset_20260401"], mcpServers: ["github"] },
        },
      },
    });

    mockedGetApprovalRetentionStatus.mockResolvedValue({
      maxHistoryCount: 2000,
      maxAgeDays: 90,
      pruneIntervalMs: 300000,
      updateMinIntervalMs: 30000,
      bounds: {
        maxHistoryCount: { min: 100, max: 10000 },
        maxAgeDays: { min: 1, max: 365 },
        pruneIntervalMs: { min: 1000, max: 86400000 },
      },
      totalRequests: 10,
      pendingRequests: 1,
      retainedHistoryRequests: 9,
      lastPrunedCount: 0,
    });

    mockedGetApprovalRetentionAudit.mockResolvedValue([]);
    mockedUpdateApprovalRetentionStatus.mockResolvedValue({
      maxHistoryCount: 2000,
      maxAgeDays: 90,
      pruneIntervalMs: 300000,
      updateMinIntervalMs: 30000,
      bounds: {
        maxHistoryCount: { min: 100, max: 10000 },
        maxAgeDays: { min: 1, max: 365 },
        pruneIntervalMs: { min: 1000, max: 86400000 },
      },
      totalRequests: 10,
      pendingRequests: 1,
      retainedHistoryRequests: 9,
      lastPrunedCount: 0,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("refreshes diagnostics when pressing R", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const panel = screen.getByLabelText(
      "Runtime diagnostics with keyboard shortcuts",
    );

    const baselineCalls = mockedGetRuntimeHealth.mock.calls.length;
    fireEvent.keyDown(panel, { key: "r" });

    await waitFor(() => {
      expect(mockedGetRuntimeHealth.mock.calls.length).toBeGreaterThan(
        baselineCalls,
      );
    });
  });

  it("toggles polling when pressing P", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const panel = screen.getByLabelText(
      "Runtime diagnostics with keyboard shortcuts",
    );

    expect(screen.getByRole("button", { name: "Pause Polling" })).toBeTruthy();

    fireEvent.keyDown(panel, { key: "p" });

    await screen.findByRole("button", { name: "Resume Polling" });
  });

  it("steps poll interval when pressing Ctrl+ArrowUp and Ctrl+ArrowDown", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const panel = screen.getByLabelText(
      "Runtime diagnostics with keyboard shortcuts",
    );

    const pollInput = screen.getByLabelText(
      "Poll Interval (ms)",
    ) as HTMLInputElement;
    expect(pollInput.value).toBe("30000");

    fireEvent.keyDown(panel, { key: "ArrowUp", ctrlKey: true });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Poll Interval (ms)") as HTMLInputElement).value,
      ).toBe("35000");
    });

    fireEvent.keyDown(panel, { key: "ArrowDown", ctrlKey: true });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Poll Interval (ms)") as HTMLInputElement).value,
      ).toBe("30000");
    });
  });

  it("ignores refresh and polling toggle shortcuts while poll input is focused", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const pollInput = screen.getByLabelText(
      "Poll Interval (ms)",
    ) as HTMLInputElement;
    pollInput.focus();

    const baselineCalls = mockedGetRuntimeHealth.mock.calls.length;

    fireEvent.keyDown(pollInput, { key: "r" });
    fireEvent.keyDown(pollInput, { key: "p" });

    expect(mockedGetRuntimeHealth.mock.calls.length).toBe(baselineCalls);
    expect(screen.getByRole("button", { name: "Pause Polling" })).toBeTruthy();
  });

  it("ignores poll-interval stepping shortcut while poll input is focused", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const pollInput = screen.getByLabelText(
      "Poll Interval (ms)",
    ) as HTMLInputElement;
    expect(pollInput.value).toBe("30000");

    pollInput.focus();
    fireEvent.keyDown(pollInput, { key: "ArrowUp", ctrlKey: true });
    fireEvent.keyDown(pollInput, { key: "ArrowDown", ctrlKey: true });

    expect(
      (screen.getByLabelText("Poll Interval (ms)") as HTMLInputElement).value,
    ).toBe("30000");
  });

  it("announces refresh shortcut activity via aria-live text", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const panel = screen.getByLabelText(
      "Runtime diagnostics with keyboard shortcuts",
    );

    expect(
      screen.getByText("Runtime diagnostics keyboard shortcuts enabled."),
    ).toBeTruthy();

    fireEvent.keyDown(panel, { key: "r" });

    await screen.findByText("Refreshing runtime diagnostics.");
  });

  it("announces polling toggle and interval updates via aria-live text", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const panel = screen.getByLabelText(
      "Runtime diagnostics with keyboard shortcuts",
    );

    fireEvent.keyDown(panel, { key: "p" });
    await screen.findByText("Polling paused.");

    fireEvent.keyDown(panel, { key: "p" });
    await screen.findByText("Polling resumed.");

    fireEvent.keyDown(panel, { key: "ArrowUp", ctrlKey: true });
    await screen.findByText("Polling interval set to 35000 ms.");

    fireEvent.keyDown(panel, { key: "ArrowDown", ctrlKey: true });
    await screen.findByText("Polling interval set to 30000 ms.");
  });

  it("reaffirms pause and resume announcements across repeated polling toggles", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const panel = screen.getByLabelText(
      "Runtime diagnostics with keyboard shortcuts",
    );

    expect(screen.getByRole("button", { name: "Pause Polling" })).toBeTruthy();

    fireEvent.keyDown(panel, { key: "p" });
    await screen.findByText("Polling paused.");
    await screen.findByRole("button", { name: "Resume Polling" });

    fireEvent.keyDown(panel, { key: "p" });
    await screen.findByText("Polling resumed.");
    await screen.findByRole("button", { name: "Pause Polling" });

    fireEvent.keyDown(panel, { key: "p" });
    await screen.findByText("Polling paused.");
    await screen.findByRole("button", { name: "Resume Polling" });
  });

  it("announces minimum clamp boundary when stepping poll interval below minimum", async () => {
    render(<RuntimeDiagnosticsPanel />);

    await screen.findByRole("heading", { name: "Runtime Diagnostics" });
    const panel = screen.getByLabelText(
      "Runtime diagnostics with keyboard shortcuts",
    );

    for (let step = 0; step < 6; step += 1) {
      fireEvent.keyDown(panel, { key: "ArrowDown", ctrlKey: true });
    }

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Poll Interval (ms)") as HTMLInputElement).value,
      ).toBe("1000");
    });

    await screen.findByText("Polling interval set to 1000 ms.");

    fireEvent.keyDown(panel, { key: "ArrowDown", ctrlKey: true });
    await screen.findByText("Polling interval set to 1000 ms.");

    expect(
      (screen.getByLabelText("Poll Interval (ms)") as HTMLInputElement).value,
    ).toBe("1000");
  });
});
