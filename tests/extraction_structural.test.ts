import { describe, expect, test } from "bun:test";
import {
  extractFrontmatter,
  extractHeadings,
  extractMarkdownLinks,
  extractStructural,
  extractTags,
  extractWikilinks,
} from "../src/extraction/structural";

describe("extraction/structural", () => {
  test("extracts frontmatter and body", () => {
    const input = "---\ntitle: Test\ncount: 3\n---\n# Heading\nBody";
    const { frontmatter, body } = extractFrontmatter(input);
    expect(frontmatter).toEqual({ title: "Test", count: 3 });
    expect(body).toContain("# Heading");
  });

  test("extracts wikilinks, markdown links, tags, headings", () => {
    const text = "# Title\nSee [[Note]] and [Link](http://example.com) #tag";
    expect(extractWikilinks(text)).toEqual(["Note"]);
    expect(extractMarkdownLinks(text)[0]).toEqual({
      text: "Link",
      url: "http://example.com",
    });
    expect(extractTags(text)).toEqual(["tag"]);
    expect(extractHeadings(text)).toEqual([{ level: 1, text: "Title" }]);
  });

  test("extractStructural builds entities and relations", () => {
    const text = "# Title\nSee [[Note]] #tag";
    const result = extractStructural(text, "/tmp/file.md", "chunk1");
    const entityNames = result.entities.map((e) => e.name);
    expect(entityNames).toContain("Note");
    expect(entityNames).toContain("tag");
    expect(result.relations.some((r) => r.relationType === "LINKS_TO")).toBe(true);
    expect(result.relations.some((r) => r.relationType === "HAS_TAG")).toBe(true);
  });

  test("extractStructural links parent headings", () => {
    const text = "# Parent\n## Child";
    const result = extractStructural(text, "/tmp/file.md", "chunk1");
    expect(result.relations.some((r) => r.relationType === "PARENT_OF")).toBe(true);
  });

  test("extractFrontmatter parses json, booleans, and quoted strings", () => {
    const input =
      "---\n" +
      'title: "Quoted Title"\n' +
      "count: 42\n" +
      "enabled: true\n" +
      "disabled: false\n" +
      'tags: ["a","b"]\n' +
      'meta: {"owner":"team"}\n' +
      "bad: [not json\n" +
      "---\n" +
      "Body";
    const { frontmatter, body } = extractFrontmatter(input);
    expect(frontmatter).toEqual({
      title: "Quoted Title",
      count: 42,
      enabled: true,
      disabled: false,
      tags: ["a", "b"],
      meta: { owner: "team" },
      bad: "[not json",
    });
    expect(body).toBe("Body");
  });

  test("extractFrontmatter returns defaults when body is missing", () => {
    const input = "---\nkey: value\n---\n";
    const result = extractFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(input);
  });

  test("extractStructural includes markdown links and frontmatter metadata", () => {
    const text =
      "---\n" +
      'topic: "Raggle"\n' +
      "---\n" +
      "# Title\n" +
      "See [Docs](https://example.com/docs).";
    const result = extractStructural(text, "/tmp/file.md", "chunk1");
    const entityNames = result.entities.map((e) => e.name);
    expect(entityNames).toContain("https://example.com/docs");
    expect(entityNames).toContain("topic: Raggle");
    expect(result.relations.some((r) => r.relationType === "LINKS_TO")).toBe(true);
    expect(result.relations.some((r) => r.relationType === "HAS_FRONTMATTER")).toBe(true);
  });
});
