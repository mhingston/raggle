import { describe, test } from "node:test";
import { expect } from "expect";
import esmock from "esmock";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getSettings } from "../src/core/config";
import { getBM25IndexPath, setCachedBM25Index } from "../src/search/bm25";
import { getGraphStore, getMetadataStore } from "../src/storage";
import { createTempIndexDir, resetAllStores } from "./helpers";

const { indexDirectory } = await esmock.p("../src/ingestion/pipeline", {
  "@xenova/transformers": {
    pipeline: async (task: string) => {
      if (task === "feature-extraction") {
        return async (texts: string[] | string) => {
          const items = Array.isArray(texts) ? texts : [texts];
          return items.map(() => {
            const data = new Float32Array(384);
            data[0] = 0.1;
            data[1] = 0.2;
            data[2] = 0.3;
            return { data };
          });
        };
      }
      if (task === "token-classification") {
        return async (_text: string) => {
          return [
            { word: "Alice", entity_group: "PER", score: 0.9, start: 0, end: 5 },
            { word: "Acme", entity_group: "ORG", score: 0.8, start: 10, end: 14 },
          ];
        };
      }
      return async () => [];
    },
  },
});

describe("ingestion/pipeline", () => {
  test("indexes with rebuild, NER, keyterms, and incremental changes", async () => {
    const indexDir = createTempIndexDir();
    const contentDir = join(indexDir, "content");
    mkdirSync(contentDir);

    const fileA = join(contentDir, "doc.md");
    const fileB = join(contentDir, "keep.md");

    const contentA =
      "---\n" +
      'title: "Doc One"\n' +
      "---\n" +
      "# Parent\n" +
      "Intro [[Concept]] and [Link](https://example.com) #tag\n" +
      "## Child\n" +
      "Alice meets Acme in Paris.";
    const contentB = "# Keep\nNo changes here.";
    writeFileSync(fileA, contentA);
    writeFileSync(fileB, contentB);

    const settings = getSettings();
    const bm25Path = getBM25IndexPath();
    const acronymPath = join(settings.indexDir, "acronyms.json");
    writeFileSync(bm25Path, "{}");
    writeFileSync(acronymPath, "{}");

    const progress: string[] = [];
    const result = await indexDirectory(contentDir, {
      rebuild: true,
      extractDepth: "ner",
      onProgress: (p) => progress.push(`${p.phase}:${p.current}/${p.total}`),
    });

    expect(result.filesProcessed).toBe(2);
    expect(progress.length).toBeGreaterThan(0);
    expect(existsSync(bm25Path)).toBe(true);
    expect(existsSync(acronymPath)).toBe(true);

    const metadata = getMetadataStore();
    const graph = getGraphStore();
    expect(metadata.getAllChunks().length).toBeGreaterThan(0);
    expect(graph.edgeCount()).toBeGreaterThan(0);

    const stats = metadata.getStats();
    expect(stats?.totalFiles).toBe(2);
    expect((stats?.totalChunks ?? 0) > 0).toBe(true);
    expect((stats?.totalEdges ?? 0) > 0).toBe(true);

    writeFileSync(fileA, `${contentA}\n\nExtra line.`);
    await indexDirectory(contentDir, { extractDepth: "structural" });

    const files = metadata.getFiles().map((f) => f.path).sort();
    expect(files).toEqual([fileA, fileB].sort());

    setCachedBM25Index(null);
    resetAllStores();
  });
});
