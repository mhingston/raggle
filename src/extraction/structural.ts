import type { Entity, ExtractionResult, Relation } from "../core/models";

interface Frontmatter {
  [key: string]: unknown;
}

export function extractFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const frontmatterText = match[1];
    const body = match[2];

    if (!frontmatterText || !body) {
      return { frontmatter: {}, body: content };
    }

    const frontmatter: Frontmatter = {};

    for (const line of frontmatterText.split("\n")) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value: unknown = line.slice(colonIndex + 1).trim();
        const valueStr = String(value);
        if (valueStr.startsWith("[") || valueStr.startsWith("{")) {
          try {
            value = JSON.parse(valueStr);
          } catch {
            // Keep as string
          }
        } else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
          value = valueStr.slice(1, -1);
        } else if (valueStr === "true") {
          value = true;
        } else if (valueStr === "false") {
          value = false;
        } else if (!Number.isNaN(Number(value))) {
          value = Number(value);
        }
        frontmatter[key] = value;
      }
    }

    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match = regex.exec(content);

  while (match) {
    const link = match[1];
    if (link) {
      links.push(link.trim());
    }
    match = regex.exec(content);
  }
  return [...new Set(links)];
}

export function extractMarkdownLinks(content: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match = regex.exec(content);

  while (match) {
    const text = match[1];
    const url = match[2];
    if (text && url) {
      links.push({
        text: text.trim(),
        url: url.trim(),
      });
    }
    match = regex.exec(content);
  }
  return links;
}

export function extractTags(content: string): string[] {
  const tags: string[] = [];
  const regex = /#([a-zA-Z0-9_-]+)/g;
  let match = regex.exec(content);

  while (match) {
    const tag = match[1];
    if (tag) {
      tags.push(tag);
    }
    match = regex.exec(content);
  }
  return [...new Set(tags)];
}

export function extractHeadings(content: string): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let match = regex.exec(content);

  while (match) {
    const hashes = match[1];
    const text = match[2];
    if (hashes && text) {
      headings.push({
        level: hashes.length,
        text: text.trim(),
      });
    }
    match = regex.exec(content);
  }
  return headings;
}

export function extractStructural(
  content: string,
  filePath: string,
  chunkId: string
): ExtractionResult {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const { frontmatter, body } = extractFrontmatter(content);

  const wikilinks = extractWikilinks(body);
  for (const link of wikilinks) {
    entities.push({
      name: link,
      type: "concept",
      source: "structural",
      chunkIds: [chunkId],
    });
    relations.push({
      sourceId: filePath,
      targetId: link,
      relationType: "LINKS_TO",
      weight: 1.0,
    });
  }

  const mdLinks = extractMarkdownLinks(body);
  for (const link of mdLinks) {
    entities.push({
      name: link.url,
      type: "concept",
      source: "structural",
      chunkIds: [chunkId],
    });
    relations.push({
      sourceId: filePath,
      targetId: link.url,
      relationType: "LINKS_TO",
      weight: 0.8,
    });
  }

  const tags = extractTags(body);
  for (const tag of tags) {
    entities.push({
      name: tag,
      type: "tag",
      source: "structural",
      chunkIds: [chunkId],
    });
    relations.push({
      sourceId: filePath,
      targetId: tag,
      relationType: "HAS_TAG",
      weight: 1.0,
    });
  }

  const headings = extractHeadings(body);
  const lastByLevel: Array<string | undefined> = [];
  for (const heading of headings) {
    entities.push({
      name: heading.text,
      type: "section",
      source: "structural",
      chunkIds: [chunkId],
    });
    if (heading.level > 1) {
      const parentHeading = lastByLevel[heading.level - 1];
      if (parentHeading) {
        relations.push({
          sourceId: parentHeading,
          targetId: heading.text,
          relationType: "PARENT_OF",
          weight: 1.0,
        });
      }
    }
    lastByLevel[heading.level] = heading.text;
    for (let level = heading.level + 1; level < lastByLevel.length; level++) {
      lastByLevel[level] = undefined;
    }
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "string") {
      const entityName = `${key}: ${value}`;
      entities.push({
        name: entityName,
        type: "metadata",
        source: "structural",
        chunkIds: [chunkId],
      });
      relations.push({
        sourceId: filePath,
        targetId: entityName,
        relationType: "HAS_FRONTMATTER",
        weight: 1.0,
      });
    }
  }

  return { entities, relations };
}
