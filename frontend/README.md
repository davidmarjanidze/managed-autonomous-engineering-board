# Frontend

Frontend application for the Managed Autonomous Engineering Board.

Built with React, Vite, and TypeScript, this UI presents the engineering lifecycle board, task controls, approval interactions, and session inspection components that connect to the backend API.

## Stack

- React 19
- TypeScript 5
- Vite 6
- Tailwind CSS 3 + custom CSS
- Vitest + Testing Library

## Main UI Capabilities

- Drag-and-drop board with five phases.
- Task create/edit/delete flows with optional screenshot upload.
- Approval-gated transitions for protected phases.
- Agent task states (processing, failed, done) with restart/stop controls.
- Session inspection panel for event streaming visibility.
- Theme toggle (light/dark) and collapsible side menu.

## Project Structure

- src/App.tsx: App shell, sidebar toggle, dark mode toggle, session viewer mounting.
- src/components/Board: Board logic and modal interactions.
- src/components/TaskCard.tsx: Task presentation and action affordances.
- src/components/ExtendedThinkingViewer.tsx: Session stream visualization.
- src/services/tasks.ts: Task and approval API client.
- src/services/sessions.ts: Runtime health API client.
- src/services/rag.ts: Docs search API client.
- src/config.ts: API base URL resolution.

## Prerequisites

- Node.js 22 or newer
- npm
- Backend service running and reachable

## Setup

1. From repository root, ensure .env exists (copy from .env.example if needed).
2. Install frontend dependencies:

   cd frontend
   npm install

## Run

- Development server:

  npm run dev

- Production build:

  npm run build

- Preview built app:

  npm run preview

Default local URL: http://localhost:5173

## Scripts

- npm run dev: Start Vite dev server.
- npm run build: Type-check and build optimized assets.
- npm run preview: Serve built assets locally.
- npm run lint: Run ESLint with zero-warning threshold.
- npm run typecheck: TypeScript project check.
- npm run test: Run Vitest test suite.
- npm run check: Run lint + typecheck + test.

## API Configuration

Frontend resolves API URL from:

1. VITE_API_BASE_URL
2. globalThis.\_\_API_BASE_URL (optional runtime override)
3. fallback: http://localhost:3000

Set VITE_API_BASE_URL in root .env for local development consistency.

## Backend Dependencies

The UI expects these backend endpoint groups:

- /tasks
- /tasks/approval-gate/\*
- /sessions/runtime-health
- /sessions/:sessionId/stream
- /rag/search

If backend is unavailable, the board surfaces an availability error and skips runtime bootstrap.

## Interaction Notes

- Keyboard shortcut: Press N while focused on board area to open task creation modal.
- Drag restrictions: Tasks in processing or failed state cannot be dragged.
- Approval flow: When an approval is required, the UI asks for confirmation before sending decision and move requests.

## Testing

Run full local validation:

npm run check

Test coverage focuses on board behaviors, docs search interactions, and runtime diagnostics interactions.

## Path Alias Convention

Use @src/\* imports for frontend source modules. Vite and TypeScript path mappings are preconfigured.
