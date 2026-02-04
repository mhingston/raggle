import { describe, test } from "node:test";
import { expect } from "expect";
import esmock from "esmock";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { createTempIndexDir } from "./helpers";

const { indexDirectory } = await esmock.p("../src/ingestion/pipeline", {
  "@xenova/transformers": {
    pipeline: async (_task: string) => {
      return async (texts: string[] | string) => {
        const items = Array.isArray(texts) ? texts : [texts];
        return items.map(() => {
          const data = new Float32Array(384);
          data[0] = 1;
          return { data };
        });
      };
    },
  },
});
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
    unlinkSync(fileB);

    await indexDirectory(contentDir, { extractDepth: "structural" });

    const store = getMetadataStore();
    const files = store.getFiles().map((f) => f.path).sort();
    expect(files).toEqual([fileARenamed]);
  });
});
