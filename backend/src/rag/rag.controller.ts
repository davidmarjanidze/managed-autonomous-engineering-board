import { BadRequestException, Controller, Get, Query } from "@nestjs/common";

import { RagSearchResponse, RagService } from "@src/rag/rag.service";

@Controller("rag")
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Get("search")
  async search(
    @Query("query") query?: string,
    @Query("limit") limitRaw?: string,
    @Query("source") source?: string,
    @Query("snippetChars") snippetCharsRaw?: string,
  ): Promise<RagSearchResponse> {
    if (typeof query !== "string" || query.trim().length === 0) {
      throw new BadRequestException("query must be a non-empty string.");
    }

    const limit =
      limitRaw === undefined ? 5 : this.parsePositiveInteger(limitRaw, "limit");
    const snippetChars =
      snippetCharsRaw === undefined
        ? 220
        : this.parsePositiveInteger(snippetCharsRaw, "snippetChars");

    if (source !== undefined && source.trim().length === 0) {
      throw new BadRequestException("source must be a non-empty string.");
    }

    if (source?.includes("..")) {
      throw new BadRequestException("source must not contain path traversal.");
    }

    return this.ragService.search(query, {
      limit: Math.min(limit, 20),
      source: source?.trim() || undefined,
      snippetChars: Math.min(Math.max(snippetChars, 80), 500),
    });
  }

  private parsePositiveInteger(raw: string, field: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer.`);
    }

    return value;
  }
}
