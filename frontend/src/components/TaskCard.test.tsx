// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCard } from "@src/components/TaskCard";
import type { Task } from "@src/services/tasks";

class MockEventSource {
  public static instances: MockEventSource[] = [];
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onopen: (() => void) | null = null;
  public close = vi.fn();

  constructor(_url: string) {
    MockEventSource.instances.push(this);
  }
}

describe("TaskCard log mode toggle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    MockEventSource.instances = [];
  });

  beforeEach(() => {
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource,
    );
  });

  it("switches between formatted and raw agent output", () => {
    const task: Task = {
      id: "task-1",
      title: "Agent task",
      description: "Example",
      phase: "in-progress",
      agentStatus: "processing",
      sessionId: "sess-123",
    };

    render(
      <TaskCard task={task} onManage={() => undefined} approvalRequests={[]} />,
    );

    const toggle = screen.getByRole("button", { name: /formatted/i });
    expect(toggle).toBeTruthy();

    const source = MockEventSource.instances[0];
    expect(source).toBeDefined();

    source?.onmessage?.({
      data: JSON.stringify({ type: "agent.message", text: "hello world" }),
    } as MessageEvent);

    expect(screen.getByText("hello world")).toBeTruthy();

    fireEvent.click(toggle);

    expect(screen.getByText(/Raw/i)).toBeTruthy();
    expect(screen.getByText(/\{\s*"type": "agent.message"/)).toBeTruthy();
  });
});
