import { describe, expect, test } from "bun:test";
import { getMetadataStore } from "../src/storage";
import { createTempIndexDir } from "./helpers";

describe("storage/metadata", () => {
  test("saves and retrieves files and chunks", () => {
    createTempIndexDir();
    const store = getMetadataStore();

    store.saveFiles([
      {
        path: "/tmp/a.md",
        title: "A",
        lastModified: new Date("2024-01-01"),
        sizeBytes: 10,
        checksum: "abc",
      },
    ]);

    store.saveChunks([
      {
        chunkId: "c1",
        filePath: "/tmp/a.md",
        headingHierarchy: ["A"],
        level: 1,
        text: "hello",
        chunkIndex: 0,
        charOffset: 0,
      },
    ]);

    const file = store.getFileByPath("/tmp/a.md");
    expect(file?.checksum).toBe("abc");

    const chunk = store.getChunk("c1");
    expect(chunk?.text).toBe("hello");

    const ids = store.getChunkIdsByFile("/tmp/a.md");
    expect(ids).toEqual(["c1"]);

    store.deleteChunksByFile("/tmp/a.md");
    expect(store.getChunk("c1")).toBeNull();
  });
});
