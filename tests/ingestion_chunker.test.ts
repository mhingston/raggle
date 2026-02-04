import { describe, test } from "node:test";
import { expect } from "expect";
import { resetSettings } from "../src/core/config";
import { chunkMarkdown, generateChunkId } from "../src/ingestion/chunker";

function withEnv(env: Record<string, string>, fn: () => void): void {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  resetSettings();
  try {
    fn();
  } finally {
    process.env = prev;
    resetSettings();
  }
}

describe("ingestion/chunker", () => {
  test("builds heading hierarchy and chunk ids", () => {
    const content = [
      "# Title",
      "Intro text.",
      "## Section A",
      "Content A.",
      "### Subsection",
      "Detail.",
    ].join("\n");

    const chunks = chunkMarkdown(content, "/tmp/file.md", 0);
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.headingHierarchy).toEqual(["Title"]);
    expect(chunks[1]?.headingHierarchy).toEqual(["Title", "Section A"]);
    expect(chunks[2]?.headingHierarchy).toEqual(["Title", "Section A", "Subsection"]);

    const id = generateChunkId("/tmp/file.md", 1);
    expect(chunks[1]?.chunkId).toBe(id);
  });

  test("splits oversized sections with overlap", () => {
    withEnv({ RAGGLE_MAX_CHUNK_TOKENS: "8", RAGGLE_CHUNK_OVERLAP: "2" }, () => {
      const content = [
        "# Title",
        "This is a sentence. Another sentence. Yet another sentence. One more.",
      ].join("\n");
      const chunks = chunkMarkdown(content, "/tmp/oversize.md", 0);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]?.text).toContain("Title");
    });
  });

  test("reuses overlap sentences between chunks", () => {
    withEnv({ RAGGLE_MAX_CHUNK_TOKENS: "8", RAGGLE_CHUNK_OVERLAP: "50" }, () => {
      const content = [
        "# Title",
        "First sentence is here. Second sentence is here. Third sentence is here.",
      ].join("\n");
      const chunks = chunkMarkdown(content, "/tmp/overlap.md", 0);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[1]?.text).toContain("Second sentence is here.");
    });
  });

  test("handles files with no headings", () => {
    const content = "plain text without headings";
    const chunks = chunkMarkdown(content, "/tmp/noheadings.md", 0);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.level).toBe(0);
  });
});
