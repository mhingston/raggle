import { describe, expect, test } from "bun:test";
import { expandQuery, analyzeQuery, preprocessQuery } from "../src/search/query";
import { saveAcronymDictionary } from "../src/extraction/acronyms";
import { createTempIndexDir } from "./helpers";

describe("search/query", () => {
  test("expandQuery uses acronym dictionary", () => {
    createTempIndexDir();
    saveAcronymDictionary(new Map([["API", "Application Programming Interface"]]));
    const expanded = expandQuery("API latency");
    expect(expanded).toContain("Application Programming Interface");
  });

  test("analyzeQuery returns tokens and hints", () => {
    const analysis = analyzeQuery("Graph Search");
    expect(analysis.tokens.length).toBeGreaterThan(0);
    expect(analysis.entityHints).toContain("Graph Search");
  });

  test("preprocessQuery normalizes whitespace and lowercases", () => {
    expect(preprocessQuery("  Foo   Bar ")).toBe("foo bar");
  });
});
