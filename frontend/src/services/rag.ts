import { API_BASE_URL } from "@src/config";

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

export async function searchDocs(
  query: string,
  limit = 5,
  source?: string,
): Promise<RagSearchResponse> {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("limit", String(limit));
  if (source && source.trim().length > 0) {
    params.set("source", source.trim());
  }

  const response = await fetch(
    `${API_BASE_URL}/rag/search?${params.toString()}`,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const rawMessage = body?.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join("; ")
      : rawMessage;
    throw new Error(message ?? `Request failed with status ${response.status}`);
  }

  return (await response.json()) as RagSearchResponse;
}
