import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";

import { RagController } from "@src/rag/rag.controller";
import { RagService, type RagSearchResponse } from "@src/rag/rag.service";

interface RagServiceMock {
  search: jest.MockedFunction<
    (
      query: string,
      options: {
        limit: number;
        source?: string;
        snippetChars: number;
      },
    ) => Promise<RagSearchResponse>
  >;
}

describe("RagController (HTTP)", () => {
  let app: INestApplication;
  let ragService: RagServiceMock;

  beforeAll(async () => {
    ragService = {
      search: jest.fn() as RagServiceMock["search"],
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RagController],
      providers: [
        {
          provide: RagService,
          useValue: ragService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /rag/search forwards validated params with defaults", async () => {
    const payload: RagSearchResponse = {
      query: "approval gate",
      results: [],
      metadata: {
        scannedDocuments: 12,
        matchedDocuments: 3,
        snippetChars: 220,
      },
    };
    ragService.search.mockResolvedValue(payload);

    const response = await request(app.getHttpServer()).get(
      "/rag/search?query=approval%20gate",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(payload);
    expect(ragService.search).toHaveBeenCalledWith("approval gate", {
      limit: 5,
      source: undefined,
      snippetChars: 220,
    });
  });

  it("GET /rag/search trims source and clamps limit/snippetChars", async () => {
    const payload: RagSearchResponse = {
      query: "retention",
      results: [],
      metadata: {
        scannedDocuments: 4,
        matchedDocuments: 1,
        snippetChars: 500,
        source: "active/",
      },
    };
    ragService.search.mockResolvedValue(payload);

    const response = await request(app.getHttpServer()).get(
      "/rag/search?query=retention&limit=999&source=%20active/%20&snippetChars=9999",
    );

    expect(response.status).toBe(200);
    expect(ragService.search).toHaveBeenCalledWith("retention", {
      limit: 20,
      source: "active/",
      snippetChars: 500,
    });
  });

  it("GET /rag/search returns 400 for empty query", async () => {
    const response = await request(app.getHttpServer()).get(
      "/rag/search?query=%20%20",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("query must be a non-empty string.");
    expect(ragService.search).not.toHaveBeenCalled();
  });

  it("GET /rag/search returns 400 for decimal limit", async () => {
    const response = await request(app.getHttpServer()).get(
      "/rag/search?query=board&limit=1.5",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("limit must be a positive integer.");
    expect(ragService.search).not.toHaveBeenCalled();
  });

  it("GET /rag/search returns 400 for invalid source", async () => {
    const response = await request(app.getHttpServer()).get(
      "/rag/search?query=board&source=../secrets",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "source must not contain path traversal.",
    );
    expect(ragService.search).not.toHaveBeenCalled();
  });

  it("GET /rag/search clamps snippetChars to minimum", async () => {
    const payload: RagSearchResponse = {
      query: "agents",
      results: [],
      metadata: {
        scannedDocuments: 5,
        matchedDocuments: 2,
        snippetChars: 80,
      },
    };
    ragService.search.mockResolvedValue(payload);

    const response = await request(app.getHttpServer()).get(
      "/rag/search?query=agents&snippetChars=1",
    );

    expect(response.status).toBe(200);
    expect(ragService.search).toHaveBeenCalledWith("agents", {
      limit: 5,
      source: undefined,
      snippetChars: 80,
    });
  });
});
