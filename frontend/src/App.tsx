import { useEffect, useState } from "react";

import { Board } from "@src/components/Board";
import { ExtendedThinkingViewer } from "@src/components/ExtendedThinkingViewer";

function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem("theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return [dark, () => setDark((d) => !d)];
}

export function App(): React.JSX.Element {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [dark, toggleDark] = useDarkMode();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <main className="page-shell">
      <div className={`app-frame ${sidebarOpen ? "" : "app-frame-collapsed"}`}>
        {sidebarOpen ? (
          <aside
            id="workspace-sidebar"
            className="app-sidebar"
            aria-label="Workspace navigation"
          >
            <nav>
              <ul className="app-sidebar-nav">
                <li>
                  <span className="nav-icon" aria-hidden="true" />
                  Sessions
                </li>
                <li className="active">
                  <span className="nav-icon" aria-hidden="true" />
                  Board
                </li>
                <li>
                  <span className="nav-icon" aria-hidden="true" />
                  Memory Store
                </li>
                <li>
                  <span className="nav-icon" aria-hidden="true" />
                  Settings
                </li>
              </ul>
            </nav>
          </aside>
        ) : null}

        <section className="app-main">
          <header className="page-toolbar">
            <button
              type="button"
              className="menu-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-controls="workspace-sidebar"
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            >
              ☰
            </button>
            <button
              type="button"
              className="dark-mode-toggle"
              onClick={toggleDark}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? "☀ Light" : "☾ Dark"}
            </button>
          </header>

          <Board onInspectSession={setSelectedSessionId} />
          {selectedSessionId ? (
            <ExtendedThinkingViewer sessionId={selectedSessionId} />
          ) : null}
        </section>
      </div>
    </main>
  );
}
