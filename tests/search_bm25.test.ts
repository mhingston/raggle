import { describe, expect, test } from "bun:test";
import { bm25Search, buildBM25Index, loadBM25Index, saveBM25Index } from "../src/search/bm25";
import { createTempIndexDir } from "./helpers";

describe("search/bm25", () => {
  test("bm25 ranks matching documents", () => {
    const index = buildBM25Index([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: [],
        level: 0,
        text: "alpha beta beta",
        chunkIndex: 0,
        charOffset: 0,
      },
      {
        chunkId: "c2",
        filePath: "/tmp/b.md",
        headingHierarchy: [],
        level: 0,
        text: "gamma delta",
        chunkIndex: 0,
        charOffset: 0,
      },
    ]);

    const results = bm25Search("alpha", index, 2);
    expect(results[0]?.[0]).toBe("c1");
  });

  test("save and load index", () => {
    const dir = createTempIndexDir();
    const index = buildBM25Index([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: [],
        level: 0,
        text: "alpha beta",
        chunkIndex: 0,
        charOffset: 0,
      },
    ]);
    const path = `${dir}/bm25_index.json`;
    saveBM25Index(index, path);
    const loaded = loadBM25Index(path);
    expect(loaded?.docCount).toBe(1);
  });

  test("bm25 returns empty for empty queries or indices", () => {
    const emptyIndex = buildBM25Index([]);
    expect(bm25Search("alpha", emptyIndex, 2)).toEqual([]);

    const index = buildBM25Index([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: [],
        level: 0,
        text: "alpha beta",
        chunkIndex: 0,
        charOffset: 0,
      },
    ]);
    expect(bm25Search("", index, 2)).toEqual([]);
  });
});
