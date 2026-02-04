import { describe, expect, test } from "bun:test";
import { normalizeScores, reciprocalRankFusion, weightedRRF } from "../src/search/fusion";

describe("search/fusion", () => {
  test("weightedRRF merges scores", () => {
    const fused = weightedRRF([
      {
        weight: 1,
        results: [
          { chunkId: "a", score: 1, engine: "semantic" },
          { chunkId: "b", score: 0.9, engine: "semantic" },
        ],
      },
      {
        weight: 1,
        results: [
          { chunkId: "b", score: 1, engine: "graph" },
          { chunkId: "c", score: 0.8, engine: "graph" },
        ],
      },
    ]);

    expect(fused.get("b")).toBeDefined();
    expect(fused.get("a")).toBeDefined();
    expect(fused.get("c")).toBeDefined();
  });

  test("reciprocalRankFusion and normalizeScores", () => {
    const fused = reciprocalRankFusion([
      [
        { chunkId: "a", score: 1, engine: "bm25" },
        { chunkId: "b", score: 0.9, engine: "bm25" },
      ],
    ]);
    expect(fused.get("a")).toBeDefined();

    const normalized = normalizeScores([
      ["a", 2],
      ["b", 1],
    ]);
    expect(normalized[0]?.[1]).toBe(1);
  });

  test("reciprocalRankFusion merges engines per chunk", () => {
    const fused = reciprocalRankFusion([
      [
        { chunkId: "a", score: 1, engine: "bm25" },
        { chunkId: "b", score: 0.9, engine: "bm25" },
      ],
      [
        { chunkId: "a", score: 0.8, engine: "semantic" },
      ],
    ]);

    const entry = fused.get("a");
    expect(entry?.engines).toEqual(["bm25", "semantic"]);
  });
});
