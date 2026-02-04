import { describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { getSettings } from "../src/core/config";
import {
  extractAcronymsFromText,
  extractAllAcronyms,
  expandQueryWithAcronyms,
  loadAcronymDictionary,
  saveAcronymDictionary,
} from "../src/extraction/acronyms";
import { createTempIndexDir } from "./helpers";

describe("extraction/acronyms", () => {
  test("extracts valid acronyms and skips noise", () => {
    const text = "Resource Description Framework (RDF) and Cascading Style Sheets (CSS).";
    const acronyms = extractAcronymsFromText(text);
    expect(acronyms.get("RDF")).toBe("Resource Description Framework");
    expect(acronyms.has("CSS")).toBe(false);
  });

  test("save/load and expandQueryWithAcronyms", () => {
    createTempIndexDir();
    const dict = new Map<string, string>([["RAG", "Retrieval Augmented Generation"]]);
    saveAcronymDictionary(dict);
    const loaded = loadAcronymDictionary();
    expect(loaded.get("RAG")?.[0]).toBe("Retrieval Augmented Generation");
    const expanded = expandQueryWithAcronyms("RAG", loaded, 1);
    expect(expanded).toContain("Retrieval Augmented Generation");
  });

  test("extractAllAcronyms prefers longer expansions", () => {
    const map = extractAllAcronyms([
      "Short Name (SN)",
      "Longer Name Here (SN)",
    ]);
    expect(map.get("SN")).toBe("Longer Name Here");
  });

  test("extracts acronym when acronym appears first", () => {
    const text = "NASA (National Aeronautics Space Administration)";
    const acronyms = extractAcronymsFromText(text);
    expect(acronyms.get("NASA")).toBe("National Aeronautics Space Administration");
  });

  test("loadAcronymDictionary returns empty on invalid json", () => {
    createTempIndexDir();
    const settings = getSettings();
    const path = join(settings.indexDir, "acronyms.json");
    writeFileSync(path, "{invalid");
    const loaded = loadAcronymDictionary();
    expect(loaded.size).toBe(0);
  });

  test("expandQueryWithAcronyms matches near acronyms", () => {
    const dict = new Map<string, string[]>([["RAG", ["Retrieval Augmented Generation"]]]);
    const expanded = expandQueryWithAcronyms("RAGG", dict, 1);
    expect(expanded).toContain("Retrieval Augmented Generation");
  });
});
