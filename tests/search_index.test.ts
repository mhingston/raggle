import { describe, expect, test } from "bun:test";
import { getMetadataStore } from "../src/storage";
import { createTempIndexDir } from "./helpers";
import { search } from "../src/search/index";
import { buildBM25Index, getBM25IndexPath, saveBM25Index, setCachedBM25Index } from "../src/search/bm25";
import { getGraphStore } from "../src/storage";

function seedChunks(): void {
  const store = getMetadataStore();
  store.saveChunks([
    {
      chunkId: "c1",
      filePath: "/tmp/a.md",
      headingHierarchy: ["Alpha"],
      level: 1,
      text: "Alpha beta gamma",
      chunkIndex: 0,
      charOffset: 0,
    },
    {
      chunkId: "c2",
      filePath: "/tmp/b.md",
      headingHierarchy: ["Delta"],
      level: 1,
      text: "Delta epsilon",
      chunkIndex: 0,
      charOffset: 0,
    },
  ]);
  store.saveStats({
    totalFiles: 2,
    totalChunks: 2,
    totalEntities: 0,
    totalEdges: 0,
    lastIndexed: new Date(),
  });
}

describe("search/index", () => {
  test("bm25 search returns results", async () => {
    createTempIndexDir();
    seedChunks();

    const results = await search("alpha", { mode: "bm25", topK: 2, rerank: false });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.chunkId).toBe("c1");
  });

  test("throws when no index present", async () => {
    createTempIndexDir();
    await expect(search("alpha")).rejects.toThrow("No index found");
  });

  test("loads bm25 index from disk when cached missing", async () => {
    createTempIndexDir();
    seedChunks();
    const store = getMetadataStore();
    const index = buildBM25Index(store.getAllChunks());
    saveBM25Index(index, getBM25IndexPath());
    setCachedBM25Index(null);

    const results = await search("alpha", { mode: "bm25", topK: 1, rerank: false });
    expect(results[0]?.chunkId).toBe("c1");
  });

  test("graph search seeds from bm25 when no ranked lists present", async () => {
    createTempIndexDir();
    seedChunks();
    const graph = getGraphStore();
    graph.addSectionNode("c1", "Alpha", 1, "/tmp/a.md", "Alpha beta gamma");
    graph.addSectionNode("c2", "Delta", 1, "/tmp/b.md", "Delta epsilon");
    graph.addEdge("section:c1", "section:c2", "PARENT_OF", 1.0);

    const results = await search("alpha", {
      mode: "graph",
      topK: 2,
      rerank: false,
      expand: false,
      graphSeed: "bm25",
    });
    expect(results.length).toBeGreaterThan(0);
  });
});
