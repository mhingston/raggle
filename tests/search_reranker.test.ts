import { describe, expect, test, mock } from "bun:test";
import { createTempIndexDir } from "./helpers";
import { getMetadataStore } from "../src/storage";

mock.module("@xenova/transformers", () => ({
  pipeline: async (_task: string) => {
    return async () => [{ label: "LABEL_1", score: 0.9 }];
  },
}));

import { blendScores, rerankAndBlend, rerankResults } from "../src/search/reranker";

describe("search/reranker", () => {
  test("rerankResults returns scored ids", async () => {
    createTempIndexDir();
    const store = getMetadataStore();
    store.saveChunks([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: [],
        level: 0,
        text: "Some text for reranking",
        chunkIndex: 0,
        charOffset: 0,
      },
    ]);

    const results = await rerankResults("query", ["c1"], 1);
    expect(results[0]?.[0]).toBe("c1");
  });

  test("blendScores combines maps", () => {
    const blended = blendScores(new Map([["a", 1]]), new Map([["a", 0.5]]));
    expect(blended.get("a")).toBeGreaterThan(0);
  });

  test("rerankAndBlend returns SearchResult", async () => {
    createTempIndexDir();
    const store = getMetadataStore();
    store.saveChunks([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: ["A"],
        level: 1,
        text: "Some text for reranking",
        chunkIndex: 0,
        charOffset: 0,
      },
    ]);

    const results = await rerankAndBlend(
      "query",
      [["c1", { score: 1, engines: ["bm25"] }]],
      1,
      {
        semanticScores: new Map([["c1", 0.1]]),
        bm25Scores: new Map([["c1", 0.9]]),
        graphScores: new Map(),
      },
      ["query"]
    );

    expect(results[0]?.chunkId).toBe("c1");
    expect(results[0]?.bm25Score).toBe(0.9);
  });
});
