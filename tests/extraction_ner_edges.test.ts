import { describe, test } from "node:test";
import { expect } from "expect";
import esmock from "esmock";

const { extractNamedEntities, getNERPipeline, resetNERPipeline } = await esmock.p(
  "../src/extraction/ner",
  {
    "@xenova/transformers": {
      pipeline: async () => {
        throw new Error("boom");
      },
    },
  }
);

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
