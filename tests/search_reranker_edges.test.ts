import { describe, expect, test, mock } from "bun:test";
import { createTempIndexDir } from "./helpers";
import { getMetadataStore } from "../src/storage";

mock.module("@xenova/transformers", () => ({
  pipeline: async () => {
    throw new Error("boom");
  },
}));

import {
  calculateLengthPenalty,
  rerankAndBlend,
  rerankResults,
  resetRerankerPipeline,
} from "../src/search/reranker";

describe("search/reranker edges", () => {
  test("rerankResults falls back when pipeline unavailable", async () => {
    createTempIndexDir();
    resetRerankerPipeline();
    const store = getMetadataStore();
    store.saveChunks([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: [],
        level: 0,
        text: "Short text",
        chunkIndex: 0,
        charOffset: 0,
      },
    ]);

    const results = await rerankResults("query", ["c1"], 1);
    expect(results[0]?.[0]).toBe("c1");
  });

  test("calculateLengthPenalty returns 0.8 for short text and 1.0 for long text", () => {
    const shortPenalty = calculateLengthPenalty("tiny");
    expect(shortPenalty).toBe(0.8);

    const longText = Array.from({ length: 30 }, () => "word").join(" ");
    const longPenalty = calculateLengthPenalty(longText);
    expect(longPenalty).toBe(1.0);
  });

  test("rerankAndBlend builds snippet around matched token", async () => {
    createTempIndexDir();
    resetRerankerPipeline();
    const store = getMetadataStore();
    store.saveChunks([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: ["A"],
        level: 1,
        text: "prefix needle suffix",
        chunkIndex: 0,
        charOffset: 0,
      },
    ]);

    const results = await rerankAndBlend(
      "needle",
      [["c1", { score: 1, engines: ["bm25"] }]],
      1,
      {
        semanticScores: new Map(),
        bm25Scores: new Map([["c1", 0.5]]),
        graphScores: new Map(),
      },
      ["needle"]
    );

    expect(results[0]?.snippet).toContain("needle");
  });
});
