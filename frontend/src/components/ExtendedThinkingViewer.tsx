import { API_BASE_URL } from "@src/config";
import { useEffect, useRef, useState } from "react";

interface SessionEvent {
  type?: string;
  role?: string;
  text?: string;
  tool?: string;
  source?: string;
  at?: string;
}

const SKIP_TYPES = new Set(["session_input_prepared", "event_start"]);

function labelFor(event: SessionEvent): { label: string; cls: string } {
  const t = event.type ?? "";
  if (t === "agent.thinking" || t === "thinking_delta")
    return { label: "Thinking", cls: "ev-thinking" };
  if (t === "agent.message") return { label: "Message", cls: "ev-message" };
  if (t === "agent.tool_use" || t === "agent.mcp_tool_use" || t === "tool_use")
    return { label: "Tool", cls: "ev-tool" };
  if (t === "agent.tool_result" || t === "agent.mcp_tool_result")
    return { label: "Result", cls: "ev-result" };
  if (t === "event_delta") return { label: "Delta", cls: "ev-delta" };
  if (t.startsWith("session.status") || t === "runtime_mode")
    return { label: "Status", cls: "ev-status" };
  if (
    t === "session_started" ||
    t === "managed_session_created" ||
    t === "session_completed"
  )
    return { label: "Lifecycle", cls: "ev-lifecycle" };
  if (t === "managed_session_error") return { label: "Error", cls: "ev-error" };
  return { label: t, cls: "ev-other" };
}

export function ExtendedThinkingViewer({
  sessionId,
}: {
  sessionId: string | null;
}): React.JSX.Element {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setConnected(false);
      return;
    }

    const source = new EventSource(
      `${API_BASE_URL}/sessions/${sessionId}/stream`,
    );
    setEvents([]);
    setConnected(false);

    source.onopen = () => setConnected(true);

    source.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as SessionEvent;
        if (!SKIP_TYPES.has(ev.type ?? "")) {
          setEvents((cur) => [...cur, ev]);
        }
      } catch {
        /* ignore parse errors */
      }
    };

    source.onerror = () => {
      setConnected(false);
      source.close();
    };

    return () => source.close();
  }, [sessionId]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  if (!sessionId) {
    return (
      <aside className="thinking-panel thinking-panel-empty">
        <p>
          Click a session link on any In Progress card to watch the agent live.
        </p>
      </aside>
    );
  }

  return (
    <aside className="thinking-panel">
      <div className="thinking-panel-header">
        <span className="thinking-panel-title">Agent Session</span>
        <span
          className={`thinking-panel-status ${connected ? "connected" : "disconnected"}`}
        >
          {connected ? "● live" : "○ disconnected"}
        </span>
        <code className="thinking-panel-session">
          {sessionId.slice(0, 20)}…
        </code>
      </div>
      <div className="thinking-events">
        {events.length === 0 ? (
          <p className="thinking-empty">Waiting for agent events…</p>
        ) : (
          events.map((ev, i) => {
            const { label, cls } = labelFor(ev);
            const body = ev.text ?? ev.tool ?? "";
            if (!body && !["Lifecycle", "Status"].includes(label)) return null;
            return (
              <div key={i} className={`thinking-event ${cls}`}>
                <span className="ev-label">{label}</span>
                {body ? <span className="ev-body">{body}</span> : null}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </aside>
  );
}
