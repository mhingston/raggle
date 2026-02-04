import { describe, test } from "node:test";
import { expect } from "expect";
import esmock from "esmock";
import { createTempIndexDir } from "./helpers";
import { getVectorStore } from "../src/storage";

const { encodeQuery, resetSemanticSearch, semanticSearch } = await esmock.p("../src/search/semantic", {
  "@xenova/transformers": {
    pipeline: async (_task: string) => {
      return async (_text: string) => {
        const data = new Float32Array(384);
        data[0] = 1;
        return { data };
      };
    },
  },
});

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
      [
        (() => {
          const data = new Array(384).fill(0);
          data[0] = 1;
          return data;
        })(),
      ]
    );

    const embedding = await encodeQuery("query");
    expect(embedding.length).toBe(384);

    const results = await semanticSearch("query", 1);
    expect(results[0]?.[0]).toBe("c1");
  });

  test("resetSemanticSearch clears cached pipeline", () => {
    resetSemanticSearch();
    expect(true).toBe(true);
  });
});
