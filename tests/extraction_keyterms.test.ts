import { describe, expect, test } from "bun:test";
import { computeTFIDF, extractHeadingTerms, extractKeyTerms } from "../src/extraction/keyterms";

describe("extraction/keyterms", () => {
  test("computeTFIDF ranks terms", () => {
    const scores = computeTFIDF([
      "alpha beta beta gamma",
      "alpha delta",
    ]);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0]?.term).toBeDefined();
  });

  test("extractKeyTerms returns keyterm entities", () => {
    const result = extractKeyTerms("# Heading Alpha\nAlpha beta beta", "chunk1", ["Other doc"]);
    const names = result.entities.map((e) => e.name);
    expect(names.length).toBeGreaterThan(0);
  });

  test("extractHeadingTerms returns heading entities", () => {
    const headings = extractHeadingTerms("# Title\n## Sub", "chunk1");
    expect(headings.map((h) => h.name)).toEqual(["Title", "Sub"]);
  });
});
