import { describe, expect, test, mock } from "bun:test";
import { createTempIndexDir } from "./helpers";
import { getGraphStore, getMetadataStore } from "../src/storage";

mock.module("@xenova/transformers", () => ({
  pipeline: async () => {
    return async () => [{ label: "LABEL_1", score: 0.9 }];
  },
}));

mock.module("../src/search/semantic", () => ({
  semanticSearch: async () => [["c1", 0.9]],
  encodeQuery: async () => [1, 0],
}));

import { search } from "../src/search/index";

describe("search/index hybrid", () => {
  test("hybrid search uses semantic and graph lists", async () => {
    createTempIndexDir();
    const store = getMetadataStore();
    const graphStore = getGraphStore();
    store.saveChunks([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: ["A"],
        level: 1,
        text: "alpha",
        chunkIndex: 0,
        charOffset: 0,
      },
      {
        chunkId: "c2",
        filePath: "/tmp/b.md",
        headingHierarchy: ["B"],
        level: 1,
        text: "beta",
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

    graphStore.addSectionNode("c1", "A", 1, "/tmp/a.md", "alpha");
    graphStore.addSectionNode("c2", "B", 1, "/tmp/b.md", "beta");
    graphStore.addEdge("section:c1", "section:c2", "PARENT_OF", 1.0);

    const results = await search("alpha", { mode: "hybrid", topK: 1, rerank: true });
    expect(results[0]?.chunkId).toBe("c1");
  });
});
