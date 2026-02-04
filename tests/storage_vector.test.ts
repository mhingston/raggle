import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createRequire } from "node:module";
import { join } from "node:path";
import { getVectorStore } from "../src/storage";
import { resetAllStores } from "./helpers";
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

  test("read-only sqlite-vec requires better-sqlite3", () => {
    const require = createRequire(import.meta.url);
    let hasBetterSqlite = false;
    try {
      require("better-sqlite3");
      hasBetterSqlite = true;
    } catch {
      // better-sqlite3 not installed
    }

    if (hasBetterSqlite) {
      // Environment supports better-sqlite3; skip this behavior check.
      return;
    }

    const dir = createTempIndexDir();
    process.env.RAGGLE_READ_ONLY = "1";

    const db = new Database(join(dir, "vectors.db"));
    db.exec("CREATE TABLE IF NOT EXISTS vec_chunks (chunk_id TEXT PRIMARY KEY)");
    db.close();

    resetAllStores();

    expect(() => getVectorStore()).toThrow(
      "Read-only sqlite-vec index requires better-sqlite3"
    );

    delete process.env.RAGGLE_READ_ONLY;
  });
});
