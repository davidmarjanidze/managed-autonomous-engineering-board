import { describe, expect, it } from "@jest/globals";

import {
  DEV_AGENT_SYSTEM_PROMPT,
  REVIEWER_AGENT_SYSTEM_PROMPT,
  TESTER_AGENT_SYSTEM_PROMPT,
} from "@src/agents/agent-prompts";

describe("agent system prompts", () => {
  it("defines a specs-first dev agent prompt with verification guidance", () => {
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain("/workspace/repo");
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain("linters/tests");
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain("Pull Request");
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain("PR URL");
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain("clone it fresh");
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain("GitHub MCP");
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain(
      "If MCP clone/commit tools are not available",
    );
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain("node_modules");
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain(".gitignore");
    expect(DEV_AGENT_SYSTEM_PROMPT).toContain(
      "Validation failures do not end the workflow",
    );
  });

  it("defines a reviewer prompt focused on risk-first findings", () => {
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain("Security");
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain("regressions");
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain("severity");
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain("remediation");
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain(
      "review the existing Pull Request only",
    );
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain("provided PR URL");
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain("do not implement fixes");
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain(
      "post a concise review summary comment",
    );
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain("node_modules");
    expect(REVIEWER_AGENT_SYSTEM_PROMPT).toContain("commit/push churn");
  });

  it("defines a tester prompt focused on reproducibility and coverage", () => {
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain(
      "unit, integration, and end-to-end",
    );
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("GitHub MCP");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("MUST NOT");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("raw shell git push");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("shell-based merge commands");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("stop and report the blocker");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("node_modules");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain(".gitignore");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("acceptance criteria");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("reproducible steps");
    expect(TESTER_AGENT_SYSTEM_PROMPT).toContain("residual risk");
  });
});
