# Managed Autonomous Engineering Board (`AGENTS.md`)

This repository implements a multi-agent autonomous software engineering lifecycle built on **Anthropic Managed Agents** (`managed-agents-2026-04-01` API header) and **Claude 3.7 Sonnet / Claude 4.6** with **Extended Thinking** enabled.

---

## 1. System Architecture & Agent Lifecycle

The system models a multi-column software development board where tasks progress autonomously through specific execution phases. Moving a card across columns initiates state changes and provisions isolated agent worker sessions.

```

```

+-------------------------------------------------------+
| TO DO |
+-------------------------------------------------------+
|
(User Drag)
v
+-------------------------------------------------------+
| IN PROGRESS |
| - Instantiates Isolated Git Worktree |
| - Runs Full-Stack Dev Agent + MCP Toolsets |
| - Generates GitHub Pull Request |
+-------------------------------------------------------+
|
(PR Created)
v
+-------------------------------------------------------+
| IN REVIEW |
| - Runs Code Reviewer Agent |
| - Inspects Code Diffs & Static Analysis Output |
+-------------------------------------------------------+
/ \
(Changes Requested) (Approved)
/ \
 v v

```

+------------------------+ +------------------------+
| IN PROGRESS | | TESTING |
| (Re-assigned to Dev) | | - Runs QA Tester Agent |
+------------------------+ | - Runs Integration UI |
| & E2E Test Suites |
+------------------------+
|
(Tests Passed)
v
+------------------------+
| DONE |
| - Cleans Worktree |
| - Auto-Merges PR |
+------------------------+

```

---

## 2. Agent Catalog & Configurations

Agents are defined once via the Anthropic Agent Definition API (`/v1/agents`) during backend application boot.

### 2.1 Full-Stack Developer Agent

- **ID / Handle:** `agent_dev_fullstack`
- **Role:** Parses ticket requirements, analyzes visual bug attachments, searches knowledge base, writes implementation code, and opens a GitHub Pull Request.
- **Extended Thinking:** Enabled (`budget_tokens: 4096`).
- **Tool Set:**
  - Native Code Execution & Bash Shell Engine (`agent_toolset_20260401`)
  - GitHub MCP Server (`github/create_branch`, `github/push_files`, `github/create_pull_request`)
  - Documentation RAG Tool (`rag_docs_search`)

```json
{
  "name": "Full-Stack Developer Agent",
  "model": {
    "id": "claude-sonnet-4-6",
    "effort": "high"
  },
  "thinking": {
    "type": "enabled",
    "budget_tokens": 4096
  },
  "system": "You are a Senior Full-Stack Engineer working in an isolated Git Worktree. Your task is to implement features or fix bugs based on ticket requirements and attached screenshots. Execute code changes, run local linters and tests, and open a PR upon completion.",
  "mcp_servers": [{ "name": "github", "url": "${GITHUB_MCP_SERVER_URL}" }]
}
```

---

### 2.2 Code Reviewer Agent

- **ID / Handle:** `agent_code_reviewer`
- **Role:** Conducts static analysis, security audits, performance evaluations, and architectural consistency checks on active PRs.
- **Extended Thinking:** Enabled (`budget_tokens: 2048`).
- **Tool Set:**
- GitHub MCP Server (`github/get_pull_request_diff`, `github/create_pull_request_comment`)

```json
{
  "name": "Code Reviewer Agent",
  "model": {
    "id": "claude-sonnet-4-6",
    "effort": "medium"
  },
  "thinking": {
    "type": "enabled",
    "budget_tokens": 2048
  },
  "system": "You are an Elite Staff Security & Code Quality Reviewer. Analyze PR diffs for syntax errors, anti-patterns, security flaws (OWASP Top 10), and test coverage gaps. Reject PRs requiring revisions or approve for downstream automated testing."
}
```

---

### 2.3 QA & Integration Tester Agent

- **ID / Handle:** `agent_qa_tester`
- **Role:** Executes unit tests, integration suites, and end-to-end browser actions against the feature branch environment.
- **Extended Thinking:** Enabled (`budget_tokens: 2048`).
- **Tool Set:**
- Native Code Execution & Bash Shell Engine (`agent_toolset_20260401`)
- Local Test Runner Integration

```json
{
  "name": "QA & Integration Tester Agent",
  "model": {
    "id": "claude-sonnet-4-6",
    "effort": "medium"
  },
  "thinking": {
    "type": "enabled",
    "budget_tokens": 2048
  },
  "system": "You are a QA Automation Specialist. Pull feature branches into an isolated test runner environment, execute integration/E2E test commands, verify UI specs match, and validate system stability."
}
```

---

## 3. Parallel Execution Engine (Git Worktree Isolation)

To eliminate race conditions and workspace corruption when multiple tasks run simultaneously, every task execution spawns an isolated **Git Worktree**.

### Directory Structure & Lifecycle Rules

```text
/repo-root
├── .git/
├── worktrees/
│   ├── ticket-101/   <-- Sandbox root for Task #101
│   ├── ticket-102/   <-- Sandbox root for Task #102
│   └── ticket-103/   <-- Sandbox root for Task #103

```

1. **Initialization:**

```bash
git worktree add ./worktrees/ticket-{ID} -b feature/ticket-{ID}

```

2. **Mounting:** Mount `./worktrees/ticket-{ID}` as the execution working directory for the task's Anthropic Agent Session.
3. **Teardown (Upon `DONE` state transition):**

```bash
git worktree remove ./worktrees/ticket-{ID} --force
git branch -d feature/ticket-{ID}

```

---

## 4. Extended Thinking & Real-Time Telemetry

Agents stream their reasoning process (_extended thinking tokens_) and tool calls directly to the UI using **Server-Sent Events (SSE)**.

### Event Format

- `thinking_delta`: Streams raw inner-monologue reasoning before actions are executed.
- `tool_use`: Captures real-time CLI tool executions, parameters, and bash outputs.

```json
{
  "event": "thinking_delta",
  "data": {
    "session_id": "sess_01J8X...",
    "task_id": "ticket-101",
    "thinking": "Inspecting the DOM structure of the navigation bar. The screenshot indicates a 12px overflow issue on mobile viewports..."
  }
}
```

---

## 5. Tool Specifications & Integrations

### 5.1 RAG Search Tool (`rag_docs_search`)

- **Purpose:** Query project specs, design guidelines, and technical documentation stored in vector storage (LanceDB / pgvector).
- **Schema Definition:**

```json
{
  "name": "rag_docs_search",
  "description": "Semantic search over project documentation, Confluence pages, and architectural specs.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query phrase" }
    },
    "required": ["query"]
  }
}
```

### 5.2 GitHub MCP Server Integration

Interacts directly with GitHub via Model Context Protocol:

- `github/create_branch`
- `github/push_files`
- `github/create_pull_request`
- `github/get_pull_request_diff`
- `github/merge_pull_request`

---

## 6. Safety, Guards & Human-in-the-Loop Approval

To protect critical infrastructure and prevent unintended merges:

1. **Destructive Command Gate:** Execution of commands matching restricted patterns (`rm -rf /`, `git push --force origin main`, DB drops) is blocked by the backend execution engine.
2. **Merge Approval Gate:** Automated merging to `main` requires an explicit user confirmation modal on the UI unless auto-merge is specifically granted for low-risk tasks.

---

## 7. Import Path Conventions

1. **Use `@src/` aliases for source imports:** In both backend and frontend TypeScript code, imports within `src/` must use `@src/...` paths instead of relative imports (`./` or `../`).
2. **No relative source imports:** Avoid introducing new relative import specifiers between source files; prefer absolute alias paths for consistency and refactor safety.
