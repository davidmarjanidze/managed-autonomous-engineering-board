import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { AgentsCoordinatorService } from "@src/agents/coordinator";
import { RagService } from "@src/rag/rag.service";
import { SessionsService } from "@src/sessions/sessions.service";
import { TasksService } from "@src/tasks/tasks.service";

describe("SessionsService developer instructions", () => {
  let service: SessionsService;

  beforeEach(() => {
    process.env.GITHUB_MCP_SERVER_URL = "https://example.test/mcp/github/";
    process.env.GITHUB_MCP_AUTH_CONFIRMED = "true";

    service = new SessionsService(
      {
        getAgentId: () => "agent_tester",
        getEnvironmentId: () => "environment-test",
        getTokenBudget: () => 4096,
        getAgentStatus: () => ({ dev: true, reviewer: true, tester: true }),
      } as unknown as AgentsCoordinatorService,
      {
        search: async () => ({ metadata: {}, results: [] }),
      } as unknown as RagService,
      {
        updateAgentState: jest.fn(),
        get: jest.fn(),
        move: jest.fn(),
      } as unknown as TasksService,
    );
  });

  afterEach(() => {
    delete process.env.GITHUB_MCP_SERVER_URL;
    delete process.env.GITHUB_MCP_AUTH_CONFIRMED;
  });

  it("uses a longer default timeout for dev sessions", () => {
    expect((service as any).getManagedSessionTimeoutMs("dev")).toBe(600000);
  });

  it("uses a longer default timeout for tester sessions", () => {
    expect((service as any).getManagedSessionTimeoutMs("tester")).toBe(600000);
  });

  it("directs the developer agent to refresh /workspace/repo with GitHub MCP and provided credentials", () => {
    const events = (service as any).buildInitialManagedEvents({
      taskId: "t-1",
      role: "dev",
      taskTitle: "Refresh repo",
      taskDescription:
        "Ensure the repository is refreshed before implementation",
      worktreeBranch: "feature/ticket-t-1",
      githubToken: "token",
      githubRepoOwner: "owner",
      githubRepoName: "repo",
    });

    const text = events[0].content[0].text;

    expect(text).toContain("/workspace/repo");
    expect(text).toContain("delete it and clone it fresh");
    expect(text).toContain("GitHub MCP");
    expect(text).toContain("If MCP clone/commit tools are not available");
    expect(text).toContain(
      "If validation fails after a meaningful code change, do not stop",
    );
    expect(text).toContain("Task ID: t-1");
    expect(text).toContain("feature/ticket-t-1");
    expect(text).toContain("Do not run raw shell push commands");
    expect(text).not.toContain("git -C /workspace/repo push origin HEAD");
    expect(text).not.toContain("curl -s -X POST");
  });

  it("moves a tester task to done after a successful managed session", async () => {
    const tasksService = {
      get: jest.fn().mockReturnValue({ id: "task-1", phase: "testing" }),
      move: jest.fn().mockReturnValue({ id: "task-1", phase: "done" }),
      updateAgentState: jest.fn(),
    } as unknown as TasksService;

    const publish = jest.fn();
    const serviceWithTaskStore = new SessionsService(
      {
        getAgentId: () => "agent_tester",
        getEnvironmentId: () => "environment-test",
        getTokenBudget: () => 4096,
        getAgentStatus: () => ({ dev: true, reviewer: true, tester: true }),
      } as unknown as AgentsCoordinatorService,
      {
        search: async () => ({ metadata: {}, results: [] }),
      } as unknown as RagService,
      tasksService,
    );

    (serviceWithTaskStore as any).publish = publish;
    (serviceWithTaskStore as any).remoteSessionIds = new Map();
    (serviceWithTaskStore as any).stoppedSessionIds = new Set();
    const mockStream = (async function* () {
      yield { type: "agent.message", text: "done" };
    })();
    const create = jest.fn() as any;
    create.mockResolvedValue({ id: "remote-session" });
    const stream = jest.fn() as any;
    stream.mockResolvedValue(mockStream);

    (serviceWithTaskStore as any).anthropic = {
      beta: {
        sessions: {
          create,
          events: {
            stream,
          },
        },
      },
    } as any;

    const input = {
      taskId: "task-1",
      role: "tester" as const,
      taskTitle: "Verify PR",
      taskDescription: "Validate the PR end to end",
      worktreePath: "/tmp/worktree",
      worktreeBranch: "feature/ticket-t-1",
    };

    await (serviceWithTaskStore as any).runManagedSession("session-1", input, [
      { type: "text", text: "start" },
    ]);

    expect(tasksService.move).toHaveBeenCalledWith("task-1", "done");
    expect(publish).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        type: "task_auto_moved",
        taskId: "task-1",
        toPhase: "done",
      }),
    );
  });

  it("detects shell-based remote pushes from tester sessions", () => {
    const shouldStop = (service as any).shouldStopTesterForShellRemoteOperation(
      {
        role: "tester",
        taskId: "t-1",
      },
      {
        type: "agent.tool_use",
        tool: "bash",
        text: "git push origin feature/ticket-t-1",
      },
    );

    expect(shouldStop).toBe(true);
  });

  it("directs tester flows to use GitHub MCP for push and merge operations", () => {
    const events = (service as any).buildInitialManagedEvents({
      taskId: "t-1",
      role: "tester",
      taskTitle: "Verify PR",
      taskDescription: "Run QA checks and merge if green",
      githubPrUrl: "https://github.com/acme/demo/pull/1",
      githubPrId: "1",
      githubRepoOwner: "acme",
      githubRepoName: "demo",
    });

    const text = events[0].content[0].text;
    expect(text).toContain("Use GitHub MCP for push and merge operations");
    expect(text).toContain("merge the existing PR via GitHub MCP");
    expect(text).toContain("MUST NOT");
    expect(text).toContain("raw shell git push");
    expect(text).toContain("shell-based merge commands");
  });

  it("interrupts a running managed session when stop is requested", async () => {
    const tasksService = {
      get: jest.fn().mockReturnValue({ id: "task-1", sessionId: "session-1" }),
      updateAgentState: jest.fn(),
      move: jest.fn(),
    } as unknown as TasksService;

    const serviceWithTaskStore = new SessionsService(
      {
        getAgentId: () => "agent_tester",
        getEnvironmentId: () => "environment-test",
        getTokenBudget: () => 4096,
        getAgentStatus: () => ({ dev: true, reviewer: true, tester: true }),
      } as unknown as AgentsCoordinatorService,
      {
        search: async () => ({ metadata: {}, results: [] }),
      } as unknown as RagService,
      tasksService,
    );

    const send = jest.fn() as any;
    send.mockResolvedValue(undefined);
    const del = jest.fn() as any;
    del.mockRejectedValue(
      new Error(
        "Cannot delete session while it is running. Send an interrupt event or wait for the session to complete.",
      ),
    );

    (serviceWithTaskStore as any).anthropic = {
      beta: {
        sessions: {
          delete: del,
          events: {
            send,
          },
        },
      },
    } as any;
    (serviceWithTaskStore as any).taskSessions = new Map([
      ["task-1", "session-1"],
    ]);
    (serviceWithTaskStore as any).remoteSessionIds = new Map([
      ["session-1", "remote-1"],
    ]);

    const result = await serviceWithTaskStore.stopTaskSession("task-1");

    expect(send).toHaveBeenCalledWith("remote-1", {
      events: [{ type: "user.interrupt" }],
    });
    expect(del).toHaveBeenCalledWith("remote-1");
    expect(result.stopped).toBe(true);
    expect(tasksService.updateAgentState).toHaveBeenCalledWith("task-1", {
      agentStatus: "failed",
      agentMessage: "Stopped by user.",
      sessionId: "session-1",
    });
  });
});
