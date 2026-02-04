import { describe, expect, test, mock } from "bun:test";
import { mkdirSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { createTempIndexDir } from "./helpers";

mock.module("@xenova/transformers", () => ({
  pipeline: async (_task: string) => {
    return async (texts: string[] | string) => {
      const items = Array.isArray(texts) ? texts : [texts];
      return items.map(() => ({ data: new Float32Array([1, 0]) }));
    };
  },
}));

import { indexDirectory } from "../src/ingestion/pipeline";
import { getMetadataStore } from "../src/storage";

describe("ingestion/pipeline incremental", () => {
  test("removes deleted files and handles renames", async () => {
    const indexDir = createTempIndexDir();
    const contentDir = join(indexDir, "content");
    mkdirSync(contentDir);

    const fileA = join(contentDir, "a.md");
    const fileB = join(contentDir, "b.md");
    writeFileSync(fileA, "# A\nAlpha beta");
    writeFileSync(fileB, "# B\nBravo charlie");

    await indexDirectory(contentDir, { extractDepth: "structural", rebuild: true });

    // Rename a.md -> a-renamed.md and delete b.md
    const fileARenamed = join(contentDir, "a-renamed.md");
    renameSync(fileA, fileARenamed);
    writeFileSync(fileARenamed, "# A\nAlpha beta");
    writeFileSync(fileB, "# B\nBravo charlie");
    writeFileSync(fileB, "");

    // Delete b.md
    writeFileSync(fileB, "# B\nBravo charlie");
    // Remove file entirely
    await Bun.file(fileB).delete();

    await indexDirectory(contentDir, { extractDepth: "structural" });

    const store = getMetadataStore();
    const files = store.getFiles().map((f) => f.path).sort();
    expect(files).toEqual([fileARenamed]);
  });
});
