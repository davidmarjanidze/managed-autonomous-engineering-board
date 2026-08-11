import { Injectable } from "@nestjs/common";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";

export interface RagSearchResult {
  source: string;
  title: string;
  snippet: string;
  score: number;
}

export interface RagSearchResponse {
  query: string;
  results: RagSearchResult[];
  metadata: {
    scannedDocuments: number;
    matchedDocuments: number;
    snippetChars: number;
    source?: string;
  };
}

export interface RagSearchOptions {
  limit: number;
  source?: string;
  snippetChars: number;
}

interface ScoredDocument {
  source: string;
  title: string;
  content: string;
  score: number;
}

@Injectable()
export class RagService {
  private readonly docsRoot: string;

  constructor() {
    this.docsRoot = this.resolveDocsRoot();
  }

  async search(
    query: string,
    options: RagSearchOptions,
  ): Promise<RagSearchResponse> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      return {
        query: normalizedQuery,
        results: [],
        metadata: {
          scannedDocuments: 0,
          matchedDocuments: 0,
          snippetChars: options.snippetChars,
          source: options.source,
        },
      };
    }

    const markdownFiles = await this.collectMarkdownFiles(
      this.docsRoot,
      options.source,
    );
    const tokens = tokenize(normalizedQuery);

    const scored: ScoredDocument[] = [];
    for (const filePath of markdownFiles) {
      const content = await readFile(filePath, "utf8");
      const score = computeScore(content, tokens);
      if (score <= 0) {
        continue;
      }

      scored.push({
        source: toDisplayPath(this.docsRoot, filePath),
        title: extractTitle(filePath, content),
        content,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, options.limit).map((document) => ({
      source: document.source,
      title: document.title,
      snippet: buildSnippet(document.content, tokens, options.snippetChars),
      score: document.score,
    }));

    return {
      query: normalizedQuery,
      results,
      metadata: {
        scannedDocuments: markdownFiles.length,
        matchedDocuments: scored.length,
        snippetChars: options.snippetChars,
        source: options.source,
      },
    };
  }

  private resolveDocsRoot(): string {
    const cwd = process.cwd();
    const candidates = [
      path.resolve(cwd, "specs"),
      path.resolve(cwd, "../specs"),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0]!;
  }

  private async collectMarkdownFiles(
    root: string,
    source?: string,
  ): Promise<string[]> {
    if (!existsSync(root)) {
      return [];
    }

    const normalizedSource = source
      ? source.replace(/\\/g, "/").replace(/^\/+/, "")
      : undefined;
    const stack = [root];
    const files: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }

        if (entry.isFile() && absolutePath.endsWith(".md")) {
          if (normalizedSource) {
            const displayPath = toDisplayPath(root, absolutePath);
            if (!displayPath.startsWith(normalizedSource)) {
              continue;
            }
          }
          files.push(absolutePath);
        }
      }
    }

    return files;
  }
}

function tokenize(query: string): string[] {
  const unique = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1),
  );

  if (unique.size === 0) {
    return [query.toLowerCase()];
  }

  return Array.from(unique);
}

function computeScore(content: string, tokens: string[]): number {
  const haystack = content.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    let fromIndex = 0;
    let matches = 0;
    while (true) {
      const index = haystack.indexOf(token, fromIndex);
      if (index < 0) {
        break;
      }
      matches += 1;
      fromIndex = index + token.length;
    }

    score += matches;
  }

  return score;
}

function extractTitle(filePath: string, content: string): string {
  const firstHeading = content
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("#"));

  if (firstHeading) {
    return firstHeading.replace(/^#+\s*/, "").trim();
  }

  return path.basename(filePath, ".md");
}

function buildSnippet(
  content: string,
  tokens: string[],
  snippetChars: number,
): string {
  const flattened = content.replace(/\s+/g, " ").trim();
  if (flattened.length === 0) {
    return "";
  }

  const haystack = flattened.toLowerCase();
  const firstToken = tokens[0] ?? "";
  const matchIndex = firstToken ? haystack.indexOf(firstToken) : -1;

  if (matchIndex < 0) {
    return flattened.slice(0, snippetChars);
  }

  const leftWindow = Math.floor(snippetChars * 0.4);
  const rightWindow = snippetChars - leftWindow;
  const start = Math.max(0, matchIndex - leftWindow);
  const end = Math.min(flattened.length, matchIndex + rightWindow);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < flattened.length ? "..." : "";

  return `${prefix}${flattened.slice(start, end).trim()}${suffix}`;
}

function toDisplayPath(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  return relative.split(path.sep).join("/");
}
