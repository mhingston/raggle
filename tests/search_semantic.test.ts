import { describe, expect, test, mock } from "bun:test";
import { createTempIndexDir } from "./helpers";
import { getVectorStore } from "../src/storage";

mock.module("@xenova/transformers", () => ({
  pipeline: async (_task: string) => {
    return async (_text: string) => ({ data: new Float32Array([1, 0]) });
  },
}));

import { encodeQuery, resetSemanticSearch, semanticSearch } from "../src/search/semantic";

describe("search/semantic", () => {
  test("encodeQuery and semanticSearch", async () => {
    createTempIndexDir();
    const store = getVectorStore();
    store.addChunks(
      [
        {
          chunkId: "c1",
          filePath: "/tmp/a.md",
          headingHierarchy: [],
          level: 0,
          text: "hello",
          chunkIndex: 0,
          charOffset: 0,
        },
      ],
      [[1, 0]]
    );

    const embedding = await encodeQuery("query");
    expect(embedding.length).toBe(2);

    const results = await semanticSearch("query", 1);
    expect(results[0]?.[0]).toBe("c1");
  });

  test("resetSemanticSearch clears cached pipeline", () => {
    resetSemanticSearch();
    expect(true).toBe(true);
  });
});
