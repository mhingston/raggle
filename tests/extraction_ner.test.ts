import { describe, test } from "node:test";
import { expect } from "expect";
import esmock from "esmock";

const { batchExtractNamedEntities, extractNamedEntities, resetNERPipeline } = await esmock.p(
  "../src/extraction/ner",
  {
    "@xenova/transformers": {
      pipeline: async (_task: string) => {
        return async () => [
          { word: "Alice", entity_group: "PER", score: 0.9, start: 0, end: 5 },
          { word: "OpenAI", entity_group: "ORG", score: 0.9, start: 6, end: 12 },
        ];
      },
    },
  }
);

describe("extraction/ner", () => {
  test("extractNamedEntities filters by types", async () => {
    const result = await extractNamedEntities("Alice OpenAI", "c1", ["person"]);
    const names = result.entities.map((e) => e.name);
    expect(names).toEqual(["Alice"]);
  });

  test("batchExtractNamedEntities returns results", async () => {
    resetNERPipeline();
    const results = await batchExtractNamedEntities(["Alice"], ["c1"], ["person"]);
    expect(results[0]?.entities[0]?.name).toBe("Alice");
  });
});
