import { describe, expect, test, mock } from "bun:test";
import { extractNamedEntities, getNERPipeline, resetNERPipeline } from "../src/extraction/ner";

mock.module("@xenova/transformers", () => ({
  pipeline: async () => {
    throw new Error("boom");
  },
}));

describe("extraction/ner edges", () => {
  test("getNERPipeline returns null when pipeline fails", async () => {
    resetNERPipeline();
    const pipeline = await getNERPipeline();
    expect(pipeline).toBeNull();
  });

  test("extractNamedEntities returns empty when pipeline unavailable", async () => {
    resetNERPipeline();
    const result = await extractNamedEntities("Alice went home", "c1");
    expect(result.entities).toEqual([]);
  });
});
