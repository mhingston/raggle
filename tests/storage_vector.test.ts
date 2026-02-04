import { describe, test } from "node:test";
import { expect } from "expect";
import { getVectorStore } from "../src/storage";
import { createTempIndexDir } from "./helpers";

describe("storage/vector", () => {
  test("adds and searches vectors", () => {
    createTempIndexDir();
    const store = getVectorStore();
    
    // Create 384-dimensional embeddings (matching default embeddingDim)
    const embedding1 = new Array(384).fill(0);
    embedding1[0] = 1; // First vector points along dimension 0
    
    const embedding2 = new Array(384).fill(0);
    embedding2[1] = 1; // Second vector points along dimension 1
    
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
        {
          chunkId: "c2",
          filePath: "/tmp/b.md",
          headingHierarchy: [],
          level: 0,
          text: "world",
          chunkIndex: 0,
          charOffset: 0,
        },
      ],
      [embedding1, embedding2]
    );

    // Search with vector similar to c1
    const queryVector = new Array(384).fill(0);
    queryVector[0] = 1;
    
    const results = store.search(queryVector, 2);
    expect(results[0]?.[0]).toBe("c1");

    store.deleteChunks(["c1"]);
    expect(store.count()).toBe(1);
  });

  test("read-only without index throws", () => {
    createTempIndexDir();
    process.env.RAGGLE_READ_ONLY = "1";

    expect(() => getVectorStore()).toThrow(
      "Vector index not found or unrecognized in read-only mode"
    );

    delete process.env.RAGGLE_READ_ONLY;
  });
});
