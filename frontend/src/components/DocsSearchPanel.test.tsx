// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocsSearchPanel } from "@src/components/DocsSearchPanel";
import { searchDocs } from "@src/services/rag";

vi.mock("@src/services/rag", () => ({
  searchDocs: vi.fn(),
}));

const mockedSearchDocs = vi.mocked(searchDocs);

describe("DocsSearchPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits search on Enter key and renders summary/results", async () => {
    mockedSearchDocs.mockResolvedValue({
      query: "retention",
      results: [
        {
          source: "progress.md",
          title: "Current Engineering Status",
          snippet: "retention safeguards",
          score: 5,
        },
      ],
      metadata: {
        scannedDocuments: 12,
        matchedDocuments: 1,
        snippetChars: 220,
      },
    });

    render(<DocsSearchPanel />);

    const queryInput = screen.getByPlaceholderText(
      "Search docs (e.g. approval retention bounds)",
    );
    fireEvent.change(queryInput, { target: { value: "retention" } });
    fireEvent.keyDown(queryInput, { key: "Enter" });

    await waitFor(() => {
      expect(mockedSearchDocs).toHaveBeenCalledWith("retention", 6, "");
    });
    await screen.findByText("Searched 12 docs, found 1 matches.");
    await screen.findByText("Current Engineering Status");
  });

  it("shows explicit empty state when there are no matches", async () => {
    mockedSearchDocs.mockResolvedValue({
      query: "nonexistent term",
      results: [],
      metadata: {
        scannedDocuments: 8,
        matchedDocuments: 0,
        snippetChars: 220,
      },
    });

    render(<DocsSearchPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search docs (e.g. approval retention bounds)",
      ),
      { target: { value: "nonexistent term" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("No documentation matches found.");
  });

  it("passes source scope and clears previous error on successful retry", async () => {
    mockedSearchDocs
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce({
        query: "board",
        results: [
          {
            source: "active/foundation-scaffold.md",
            title: "Overview",
            snippet: "board",
            score: 2,
          },
        ],
        metadata: {
          scannedDocuments: 4,
          matchedDocuments: 1,
          snippetChars: 220,
          source: "active/",
        },
      });

    render(<DocsSearchPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search docs (e.g. approval retention bounds)",
      ),
      { target: { value: "board" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Optional source scope (e.g. active/)"),
      { target: { value: "active/" } },
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("backend unavailable");

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(mockedSearchDocs).toHaveBeenLastCalledWith("board", 6, "active/");
    });
    await screen.findByText("Searched 4 docs within active/, found 1 matches.");
    expect(screen.queryByText("backend unavailable")).toBeNull();
  });

  it("renders source-aware summary when scoped search has zero matches", async () => {
    mockedSearchDocs.mockResolvedValue({
      query: "unknown",
      results: [],
      metadata: {
        scannedDocuments: 3,
        matchedDocuments: 0,
        snippetChars: 220,
        source: "active/",
      },
    });

    render(<DocsSearchPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search docs (e.g. approval retention bounds)",
      ),
      { target: { value: "unknown" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("Optional source scope (e.g. active/)"),
      { target: { value: "active/" } },
    );
    fireEvent.keyDown(
      screen.getByPlaceholderText("Optional source scope (e.g. active/)"),
      { key: "Enter" },
    );

    await screen.findByText("Searched 3 docs within active/, found 0 matches.");
    await screen.findByText("No documentation matches found.");
  });
});
