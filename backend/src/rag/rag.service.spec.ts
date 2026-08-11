import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { RagService } from "@src/rag/rag.service";

describe("RagService", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "rag-service-spec-"));

    await mkdir(path.join(tempRoot, "active"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "active", "alpha.md"),
      "# Alpha\nRetention safeguards retention checks and approval gate.",
      "utf8",
    );
    await writeFile(
      path.join(tempRoot, "roadmap.md"),
      "# Roadmap\nBoard workflow plans and release milestones.",
      "utf8",
    );
    await writeFile(path.join(tempRoot, "ignored.txt"), "ignore", "utf8");
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns empty results and metadata for blank query", async () => {
    const service = new RagService();
    (service as unknown as { docsRoot: string }).docsRoot = tempRoot;

    const response = await service.search("   ", {
      limit: 3,
      snippetChars: 120,
      source: "active/",
    });

    expect(response.query).toBe("");
    expect(response.results).toEqual([]);
    expect(response.metadata).toEqual({
      scannedDocuments: 0,
      matchedDocuments: 0,
      snippetChars: 120,
      source: "active/",
    });
  });

  it("scores and ranks documents by token frequency", async () => {
    const service = new RagService();
    (service as unknown as { docsRoot: string }).docsRoot = tempRoot;

    const response = await service.search("retention", {
      limit: 5,
      snippetChars: 140,
    });

    expect(response.metadata.scannedDocuments).toBe(2);
    expect(response.metadata.matchedDocuments).toBe(1);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.title).toBe("Alpha");
    expect(response.results[0]?.source).toBe("active/alpha.md");
    expect(response.results[0]?.score).toBeGreaterThanOrEqual(2);
  });

  it("applies source scope filtering and keeps scoped metadata", async () => {
    const service = new RagService();
    (service as unknown as { docsRoot: string }).docsRoot = tempRoot;

    const response = await service.search("board", {
      limit: 5,
      source: "active/",
      snippetChars: 120,
    });

    expect(response.metadata.scannedDocuments).toBe(1);
    expect(response.metadata.matchedDocuments).toBe(0);
    expect(response.metadata.source).toBe("active/");
    expect(response.results).toEqual([]);
  });

  it("uses snippetChars budget for snippet truncation windows", async () => {
    const service = new RagService();
    (service as unknown as { docsRoot: string }).docsRoot = tempRoot;

    const response = await service.search("workflow", {
      limit: 5,
      snippetChars: 90,
    });

    expect(response.results).toHaveLength(1);
    const snippet = response.results[0]?.snippet ?? "";
    expect(snippet.length).toBeLessThanOrEqual(96);
    expect(snippet.toLowerCase()).toContain("workflow");
  });

  it("falls back to raw token when query contains only single-character tokens", async () => {
    const service = new RagService();
    (service as unknown as { docsRoot: string }).docsRoot = tempRoot;

    const response = await service.search("a", {
      limit: 2,
      snippetChars: 80,
    });

    expect(response.metadata.scannedDocuments).toBe(2);
    expect(response.metadata.matchedDocuments).toBeGreaterThan(0);
    expect(response.results.length).toBeGreaterThan(0);
  });
});
