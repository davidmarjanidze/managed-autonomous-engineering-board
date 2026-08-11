import { useState } from "react";

import { searchDocs, type RagSearchResult } from "@src/services/rag";

export function DocsSearchPanel(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [results, setResults] = useState<RagSearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const onSearch = async (): Promise<void> => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setError("Enter a docs query to search specs.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError(null);
    setSummary(null);

    try {
      const response = await searchDocs(trimmed, 6, source);
      setResults(response.results);
      setHasSearched(true);
      const sourceSegment = response.metadata.source
        ? ` within ${response.metadata.source}`
        : "";
      setSummary(
        `Searched ${response.metadata.scannedDocuments} docs${sourceSegment}, found ${response.metadata.matchedDocuments} matches.`,
      );
      setStatus("idle");
    } catch (requestError) {
      setStatus("error");
      setHasSearched(true);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to search docs.",
      );
    }
  };

  return (
    <section className="docs-search-panel">
      <div className="docs-search-header">
        <h2>Docs Search</h2>
        <p>Query local specs and implementation notes using lightweight RAG.</p>
      </div>
      <div className="docs-search-controls">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search docs (e.g. approval retention bounds)"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void onSearch();
            }
          }}
        />
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="Optional source scope (e.g. active/)"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void onSearch();
            }
          }}
        />
        <button type="button" onClick={() => void onSearch()}>
          {status === "loading" ? "Searching..." : "Search"}
        </button>
      </div>
      {error ? <p className="docs-search-error">{error}</p> : null}
      {summary ? <p className="docs-search-summary">{summary}</p> : null}
      {hasSearched && !error && status !== "loading" && results.length === 0 ? (
        <p className="docs-search-empty">No documentation matches found.</p>
      ) : null}
      <ul className="docs-search-results">
        {results.map((result) => (
          <li key={`${result.source}-${result.title}`}>
            <h3>{result.title}</h3>
            <p className="docs-search-source">{result.source}</p>
            <p>{result.snippet}</p>
            <p className="docs-search-score">score: {result.score}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
