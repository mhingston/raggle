import { createHash } from "node:crypto";
import { getSettings } from "../core/config";
import type { Chunk } from "../core/models";
import { estimateTokens, splitSentences } from "../utils/text";

interface Section {
  level: number;
  heading: string;
  body: string;
  charOffset: number;
}

function parseAtxHeadings(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split("\n");

  let currentSection: Section | null = null;
  let bodyLines: string[] = [];
  let preambleLines: string[] = [];
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      charOffset += 1;
      continue;
    }

    const match = line.match(/^(#{1,6})\s+(.+)$/);

    if (match) {
      // Save previous section if exists
      if (currentSection) {
        currentSection.body = bodyLines.join("\n").trim();
        sections.push(currentSection);
      } else if (preambleLines.length > 0) {
        sections.push({
          level: 0,
          heading: "",
          body: preambleLines.join("\n").trim(),
          charOffset: 0,
        });
        preambleLines = [];
      }

      // Start new section
      const level = match[1]?.length ?? 0;
      const heading = match[2]?.trim() ?? "";

      currentSection = {
        level,
        heading,
        body: "",
        charOffset,
      };

      bodyLines = [];
    } else if (currentSection) {
      bodyLines.push(line);
    } else {
      preambleLines.push(line);
    }

    charOffset += line.length + 1; // +1 for newline
  }

  // Don't forget the last section
  if (currentSection) {
    currentSection.body = bodyLines.join("\n").trim();
    sections.push(currentSection);
  }

  // If no sections found, treat entire content as one section
  if (sections.length === 0) {
    sections.push({
      level: 0,
      heading: "",
      body: content.trim(),
      charOffset: 0,
    });
  }

  return sections;
}

function buildHeadingHierarchy(sections: Section[], currentIndex: number): string[] {
  const hierarchy: string[] = [];
  const currentSection = sections[currentIndex];

  if (!currentSection) return hierarchy;

  // Look for nearest parent headings at each higher level
  const parents = new Map<number, string>();
  for (let i = currentIndex - 1; i >= 0; i--) {
    const section = sections[i];
    if (!section || !section.heading) continue;
    if (section.level < currentSection.level && !parents.has(section.level)) {
      parents.set(section.level, section.heading);
    }
  }

  const sortedLevels = Array.from(parents.keys()).sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const heading = parents.get(level);
    if (heading) {
      hierarchy.push(heading);
    }
  }

  if (currentSection.heading) {
    hierarchy.push(currentSection.heading);
  }

  return hierarchy;
}

function splitIntoSentences(text: string): string[] {
  return splitSentences(text);
}

function chunkSection(
  section: Section,
  hierarchy: string[],
  filePath: string,
  chunkIndex: number,
  settings: ReturnType<typeof getSettings>
): Chunk[] {
  const chunks: Chunk[] = [];
  const headingPath = hierarchy.join(" > ");

  // Build full text with heading path
  const fullText = headingPath ? `${headingPath}\n\n${section.body}` : section.body;

  const tokenCount = estimateTokens(fullText);

  if (tokenCount <= settings.maxChunkTokens) {
    // Section fits in one chunk
    const chunkId = createHash("md5").update(`${filePath}:${chunkIndex}`).digest("hex");

    chunks.push({
      chunkId,
      filePath,
      headingHierarchy: hierarchy,
      level: section.level,
      text: fullText,
      chunkIndex,
      charOffset: section.charOffset,
    });
  } else {
    // Need to split section into smaller chunks with overlap
    const sentences = splitIntoSentences(section.body);
    let currentChunk: string[] = [];
    let currentTokens = headingPath ? estimateTokens(headingPath) + 10 : 0;
    let currentChunkIndex = chunkIndex;

    for (const sentence of sentences) {
      const sentenceTokens = estimateTokens(sentence);

      if (currentTokens + sentenceTokens > settings.maxChunkTokens && currentChunk.length > 0) {
        // Save current chunk
        const chunkText = headingPath
          ? `${headingPath}\n\n${currentChunk.join(" ")}`
          : currentChunk.join(" ");
        const chunkId = createHash("md5").update(`${filePath}:${currentChunkIndex}`).digest("hex");

        chunks.push({
          chunkId,
          filePath,
          headingHierarchy: hierarchy,
          level: section.level,
          text: chunkText,
          chunkIndex: currentChunkIndex,
          charOffset: section.charOffset,
        });

        // Start new chunk with overlap
        const overlapTokens = settings.chunkOverlapTokens;
        let overlapText = "";
        const overlapSentences: string[] = [];

        for (let i = currentChunk.length - 1; i >= 0; i--) {
          const s = currentChunk[i];
          if (!s) continue;

          if (estimateTokens(overlapText + s) <= overlapTokens) {
            overlapSentences.unshift(s);
            overlapText = overlapSentences.join(" ");
          } else {
            break;
          }
        }

        currentChunk = [...overlapSentences];
        currentTokens = headingPath
          ? estimateTokens(headingPath) + 10 + estimateTokens(overlapText)
          : estimateTokens(overlapText);
        currentChunkIndex++;
      }

      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      const chunkText = headingPath
        ? `${headingPath}\n\n${currentChunk.join(" ")}`
        : currentChunk.join(" ");
      const chunkId = createHash("md5").update(`${filePath}:${currentChunkIndex}`).digest("hex");

      chunks.push({
        chunkId,
        filePath,
        headingHierarchy: hierarchy,
        level: section.level,
        text: chunkText,
        chunkIndex: currentChunkIndex,
        charOffset: section.charOffset,
      });
    }
  }

  return chunks;
}

export function chunkMarkdown(content: string, filePath: string, startIndex: number = 0): Chunk[] {
  const settings = getSettings();
  const sections = parseAtxHeadings(content);
  const chunks: Chunk[] = [];

  let chunkIndex = startIndex;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section) continue;

    const hierarchy = buildHeadingHierarchy(sections, i);

    const sectionChunks = chunkSection(section, hierarchy, filePath, chunkIndex, settings);

    chunks.push(...sectionChunks);
    chunkIndex += sectionChunks.length;
  }

  return chunks;
}

export function generateChunkId(filePath: string, chunkIndex: number): string {
  return createHash("md5").update(`${filePath}:${chunkIndex}`).digest("hex");
}
