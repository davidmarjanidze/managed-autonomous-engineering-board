import { useEffect, useRef, useState } from "react";

import { API_BASE_URL } from "@src/config";
import type { ApprovalRequest, Task } from "@src/services/tasks";

interface LogEntry {
  icon: string;
  text: string;
}

interface ParsedLogEntry {
  entry: LogEntry | null;
  activity?: string;
}

function extractRawOutputText(raw: Record<string, unknown>): string | null {
  const type = String(raw.type ?? "");

  if (type === "agent.thinking" || type === "thinking_delta") {
    const text = String(raw.thinking ?? raw.text ?? "").trim();
    return text || null;
  }

  if (type === "event_delta") {
    const delta = raw.delta as Record<string, unknown> | undefined;
    const text = String(
      delta?.thinking ?? delta?.text ?? raw.text ?? "",
    ).trim();
    return text || null;
  }

  if (type === "agent.message" && Array.isArray(raw.content)) {
    const text = (raw.content as Array<Record<string, unknown>>)
      .filter((block) => block.type === "text")
      .map((block) => String(block.text ?? "").trim())
      .filter(Boolean)
      .join("\n");
    return text || null;
  }

  if (typeof raw.text === "string") {
    const text = raw.text.trim();
    if (text && !String(raw.tool ?? "").trim()) {
      return text;
    }
  }

  return null;
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function resolveToolActivity(raw: Record<string, unknown>): string | undefined {
  const rawToolUse =
    (raw.tool_use as Record<string, unknown> | undefined) ??
    (raw.mcp_tool_use as Record<string, unknown> | undefined);
  const rawInput = rawToolUse?.input as Record<string, unknown> | undefined;
  const fallbackTool =
    typeof raw.tool === "string" ? String(raw.tool).trim() : "";
  const rawName =
    typeof rawToolUse?.name === "string"
      ? String(rawToolUse.name).trim()
      : fallbackTool;

  if (rawName === "bash") {
    const goal = typeof rawInput?.goal === "string" ? rawInput.goal : "";
    const command =
      typeof rawInput?.command === "string" ? rawInput.command : "";
    if (goal) {
      return `bash: ${truncate(goal)}`;
    }
    if (command) {
      return `bash: ${truncate(command)}`;
    }
    return "bash";
  }

  if (rawName && rawName !== "tool") {
    return rawName;
  }

  const nestedToolName =
    typeof rawInput?.tool_name === "string"
      ? rawInput.tool_name
      : typeof rawInput?.name === "string"
        ? rawInput.name
        : typeof rawInput?.tool === "string"
          ? rawInput.tool
          : "";

  if (nestedToolName) {
    return nestedToolName;
  }

  return undefined;
}

function parseLogEntry(raw: Record<string, unknown>): ParsedLogEntry {
  const type = String(raw.type ?? "");

  // Tool use — try raw tool_use first (passed through from managed event), then normalized `tool`
  if (
    type === "agent.tool_use" ||
    type === "agent.mcp_tool_use" ||
    type === "tool_use"
  ) {
    const activity = resolveToolActivity(raw) ?? "tool";
    return {
      entry: { icon: "⌨", text: `Running: ${activity}` },
      activity,
    };
  }

  // Agent message text — try raw content array first, then normalized `text`
  if (type === "agent.message") {
    if (Array.isArray(raw.content)) {
      const text = (raw.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text")
        .map((b) => String(b.text ?? ""))
        .join(" ");
      if (text) return { entry: { icon: "☐", text } };
    }
    if (raw.text) return { entry: { icon: "☐", text: String(raw.text) } };
    return { entry: null };
  }

  // Thinking events
  if (type === "agent.thinking" || type === "thinking_delta") {
    const text = String(raw.thinking ?? raw.text ?? "");
    return text ? { entry: { icon: "◎", text } } : { entry: null };
  }

  // Streaming delta frames
  if (type === "event_delta") {
    const delta = raw.delta as Record<string, unknown> | undefined;
    const text = String(delta?.thinking ?? delta?.text ?? raw.text ?? "");
    return text ? { entry: { icon: "◎", text } } : { entry: null };
  }

  // Simulated events already have normalized `tool` + `text`
  if (raw.text && raw.tool) {
    const activity = resolveToolActivity(raw) ?? String(raw.tool);
    return {
      entry: { icon: "⌨", text: `Running: ${activity}` },
      activity,
    };
  }
  if (raw.text && type.includes("think")) {
    return { entry: { icon: "◎", text: String(raw.text) } };
  }
  if (raw.text && type === "message") {
    return { entry: { icon: "☐", text: String(raw.text) } };
  }

  return { entry: null };
}

interface TaskCardProps {
  task: Task;
  onManage: (task: Task) => void;
  onInspectSession?: (sessionId: string) => void;
  onRestartAgent?: (taskId: string) => void;
  onStopAgent?: (taskId: string) => void;
  approvalRequests: ApprovalRequest[];
}

export function TaskCard({
  task,
  onManage,
  onInspectSession,
  onRestartAgent,
  onStopAgent,
  approvalRequests,
}: TaskCardProps): React.JSX.Element {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [rawLog, setRawLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(true);
  const [showRawOutput, setShowRawOutput] = useState(true);
  const [currentActivity, setCurrentActivity] = useState("starting agent");
  const [elapsedSec, setElapsedSec] = useState(0);
  const startRef = useRef<number>(Date.now());
  const logRef = useRef<HTMLDivElement>(null);

  const isProcessing = task.agentStatus === "processing";
  const isFailed = task.agentStatus === "failed";

  // Connect to SSE when card is in-progress and has a session
  useEffect(() => {
    if (!isProcessing || !task.sessionId) return;
    startRef.current = Date.now();
    setElapsedSec(0);
    setLog([]);
    setRawLog([]);
    setCurrentActivity("initializing session");

    const src = new EventSource(
      `${API_BASE_URL}/sessions/${task.sessionId}/stream`,
    );
    src.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as Record<string, unknown>;
        const rawText = extractRawOutputText(ev);
        if (rawText) {
          setRawLog((prev) => [...prev, rawText].slice(-30));
        }
        const parsed = parseLogEntry(ev);
        if (parsed.activity) {
          setCurrentActivity(parsed.activity);
        }
        const entry = parsed.entry;
        if (entry) {
          setLog((prev) => [...prev, entry].slice(-30));
        }
      } catch {
        /* ignore */
      }
    };

    return () => src.close();
  }, [isProcessing, task.sessionId]);

  // Elapsed timer ticking every second while in-progress
  useEffect(() => {
    if (!isProcessing) return;
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isProcessing]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (showLog && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, rawLog, showLog, showRawOutput]);

  const elapsed = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;

  const phaseToneClass = `task-phase-chip task-phase-${task.phase}`;

  return (
    <article className="task-card" onDoubleClick={() => onManage(task)}>
      <div className="task-meta-row">
        <span className="task-ticket-chip">{task.id}</span>
        <span className={phaseToneClass}>{task.phase.replace("-", " ")}</span>
        {task.agentStatus ? (
          <span
            className={`task-agent-state task-agent-state-${task.agentStatus}`}
          >
            {isProcessing ? (
              <span className="task-agent-spinner" aria-hidden="true" />
            ) : null}
            {task.agentStatus}
          </span>
        ) : null}
        {isProcessing ? <span className="task-timer">{elapsed}</span> : null}
      </div>

      <h3>{task.title}</h3>
      <p className="task-description">{task.description}</p>

      {task.githubPrUrl ? (
        <p className="task-meta-line">
          GitHub PR: <a href={task.githubPrUrl}>{task.githubPrUrl}</a>
        </p>
      ) : null}

      {isProcessing ? (
        <p className="task-running-pill">
          <span className="task-running-dot" />
          Running: {currentActivity}
        </p>
      ) : null}

      {/* Inline agent log */}
      {isProcessing && (log.length > 0 || task.sessionId) ? (
        <div className="card-log">
          <div className="card-log-header">
            <button
              type="button"
              className="card-log-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setShowLog((v) => !v);
              }}
            >
              {showLog ? "▲ Hide log" : "▼ Show log"}
            </button>
            <button
              type="button"
              className="card-log-mode-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setShowRawOutput((v) => !v);
              }}
            >
              {showRawOutput ? "Raw" : "Formatted"}
            </button>
          </div>
          {showLog ? (
            <div className="card-log-entries" ref={logRef}>
              {(showRawOutput ? rawLog.length : log.length) === 0 ? (
                <span className="card-log-waiting">
                  {showRawOutput
                    ? "Waiting for agent thinking..."
                    : "Waiting for agent..."}
                </span>
              ) : (
                (showRawOutput ? rawLog : log).map((entry, i) =>
                  showRawOutput ? (
                    <div key={i} className="card-log-entry card-log-entry-raw">
                      <span className="card-log-icon">◎</span>
                      <pre className="card-log-text card-log-text-raw">
                        {entry as string}
                      </pre>
                    </div>
                  ) : (
                    <div key={i} className="card-log-entry">
                      <span className="card-log-icon">
                        {(entry as LogEntry).icon}
                      </span>
                      <span className="card-log-text">
                        {(entry as LogEntry).text}
                      </span>
                    </div>
                  ),
                )
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!isProcessing && task.worktreeMessage ? (
        <p className="task-meta-line">{task.worktreeMessage}</p>
      ) : null}

      {isFailed && task.agentMessage ? (
        <p className="task-meta-line task-meta-line-error">
          {task.agentMessage}
        </p>
      ) : null}

      {/* Session footer */}
      <p className="task-card-footer">
        {task.sessionId ? (
          <button
            type="button"
            className="task-session-link"
            onClick={(e) => {
              e.stopPropagation();
              onInspectSession?.(task.sessionId!);
            }}
          >
            Session: {task.sessionId.slice(0, 20)}…
          </button>
        ) : (
          <span>Double-click to manage</span>
        )}
        {isFailed ? (
          <button
            type="button"
            className="task-restart-button"
            onClick={(e) => {
              e.stopPropagation();
              onRestartAgent?.(task.id);
            }}
          >
            Restart agent
          </button>
        ) : null}
        {isProcessing ? (
          <button
            type="button"
            className="task-stop-button"
            onClick={(e) => {
              e.stopPropagation();
              onStopAgent?.(task.id);
            }}
          >
            Stop agent
          </button>
        ) : null}
        <span className="task-kebab" aria-hidden="true">
          ···
        </span>
      </p>

      {approvalRequests.length > 0 ? (
        <p className="task-meta-line">
          {approvalRequests.length} approval events
        </p>
      ) : null}
    </article>
  );
}
