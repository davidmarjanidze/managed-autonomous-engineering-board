# Backend

Backend service for the Managed Autonomous Engineering Board.

Built with NestJS and TypeScript, this service provides task lifecycle APIs, approval-gate controls, managed-session orchestration hooks, SSE event streaming, and local documentation search.

## Stack

- Node.js 22+
- NestJS 11
- TypeScript 5
- Jest + Supertest
- SQLite (Node DatabaseSync) for persisted board state

## Responsibilities

- Task state management across phases.
- Agent lifecycle signaling per phase (dev, reviewer, tester).
- Approval gate policy, approval requests, and retention controls.
- Managed session runtime health and stream endpoints.
- RAG search endpoint over markdown docs.

## Key Modules

- src/tasks: Task CRUD, phase transitions, approval integration, restart/stop flows.
- src/sessions: Managed session orchestration, runtime health, SSE stream relay.
- src/agents: Agent registration metadata and managed role setup.
- src/rag: Query-time documentation search.

## Prerequisites

- Node.js 22 or newer
- npm
- Root-level .env file (the backend loads ../.env)

## Setup

1. From repository root, copy environment template:

   cp .env.example .env

2. Install backend dependencies:

   cd backend
   npm install

## Run

- Development:

  npm run start:dev

- Build:

  npm run build

- Production start (after build):

  npm run start

## Scripts

- npm run start:dev: Start Nest in watch mode.
- npm run build: Compile TypeScript and rewrite @src path aliases with tsc-alias.
- npm run start: Run compiled output from dist/main.js.
- npm run lint: Run ESLint against src/\*_/_.ts.
- npm run test: Run unit and HTTP tests with Jest.

## Environment Variables

The backend reads variables from the root .env file.

Core runtime:

- API_PORT: HTTP port (default 3000).
- API_BASE_URL: Canonical API base URL value.
- NODE_ENV: Runtime mode.

Persistence:

- STATE_DB_PATH: SQLite file path.
- LEGACY_STATE_JSON_PATH: Optional legacy import source.

Approval retention policy:

- APPROVAL_HISTORY_MAX_RECORDS
- APPROVAL_HISTORY_MAX_AGE_DAYS
- APPROVAL_HISTORY_PRUNE_INTERVAL_MS
- APPROVAL_RETENTION_UPDATE_MIN_INTERVAL_MS

Managed agents:

- ANTHROPIC_API_KEY
- ANTHROPIC_BETA_HEADER
- ANTHROPIC_ENVIRONMENT_ID
- ANTHROPIC_AGENT_MODEL
- ANTHROPIC_DEV_AGENT_MODEL
- ANTHROPIC_REVIEWER_AGENT_MODEL
- ANTHROPIC_TESTER_AGENT_MODEL
- ANTHROPIC_DEV_AGENT_ID
- ANTHROPIC_REVIEWER_AGENT_ID
- ANTHROPIC_TESTER_AGENT_ID

Token budgeting:

- TOKEN_BUDGET_DEV
- TOKEN_BUDGET_REVIEWER
- TOKEN_BUDGET_TESTER

GitHub/MCP integration:

- GITHUB_PERSONAL_ACCESS_TOKEN
- GITHUB_REPOSITORY_OWNER
- GITHUB_REPOSITORY_NAME
- GITHUB_MCP_DOMAIN
- GITHUB_MCP_SERVER_URL

## API Overview

Base URL: http://localhost:3000

Tasks:

- GET /tasks: List all tasks.
- POST /tasks: Create or update task.
- DELETE /tasks/:taskId: Delete task (blocked while processing).
- PATCH /tasks/:taskId/phase: Move task to target phase (approval-aware).
- POST /tasks/:taskId/restart: Restart failed agent session.
- POST /tasks/:taskId/stop: Stop an active processing agent session.

Approval gate:

- GET /tasks/approval-gate: Read gate state.
- PATCH /tasks/approval-gate: Enable/disable gate.
- POST /tasks/approval-gate/evaluate: Evaluate whether a transition requires approval.
- GET /tasks/approval-gate/requests: Paginated approval request list.
- POST /tasks/approval-gate/requests/:requestId/decision: Approve/reject a request.
- GET /tasks/approval-gate/retention: Read retention policy and counters.
- PATCH /tasks/approval-gate/retention: Update retention policy.
- GET /tasks/approval-gate/retention/audit: Read retention policy audit entries.

Sessions:

- GET /sessions/runtime-health: Runtime capability and configuration diagnostics.
- GET /sessions/managed: List active local->remote session bindings.
- DELETE /sessions/managed/:localSessionId: Terminate one managed remote session.
- DELETE /sessions/managed: Terminate all managed remote sessions.
- GET /sessions/:sessionId/stream (SSE): Stream session events to clients.

RAG:

- GET /rag/search: Search markdown docs with query, limit, optional source scope, and snippet length controls.

## Runtime Modes

- Managed mode: Enabled when API key, agent registration, MCP config, and session capabilities are available.
- Simulated mode: Used automatically when managed prerequisites are incomplete.

The endpoint GET /sessions/runtime-health returns runtimeMode and explicit reasons when managed mode is unavailable.

## Persistence

- Task and approval state are persisted to SQLite via StateStoreService.
- Seed tasks are reset on backend startup.
- Approval retention audit history is persisted and reloaded on boot.

## Testing

Run tests:

npm run test

Includes:

- Unit tests for services and policy logic.
- HTTP-level endpoint tests with Supertest.

## Path Alias Convention

Use @src/\* imports for backend source modules. Build and Jest config already map this alias.
