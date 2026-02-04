import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSettings } from "../core/config";
import { isNoiseToken } from "../utils/text";

export type AcronymDictionary = Map<string, string[]>;

const ACRONYM_PATTERNS = [
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\(([A-Z]{2,})\)/g,
  /([A-Z]{2,})\s*\(([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\)/g,
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-—]\s*([A-Z]{2,})/g,
];

export function extractAcronymsFromText(text: string): Map<string, string> {
  const acronyms = new Map<string, string>();
  for (const pattern of ACRONYM_PATTERNS) {
    // Reset lastIndex to avoid skipping matches across calls (global regexes).
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const item1 = match[1];
      const item2 = match[2];
      if (item1 && item2) {
        const fullName = item1.trim();
        const acronym = item2.trim();
        if (/^[A-Z]{2,}$/.test(acronym)) {
          if (!isNoiseToken(acronym)) {
            acronyms.set(acronym, fullName);
          }
        } else if (/^[A-Z]{2,}$/.test(fullName)) {
          if (!isNoiseToken(fullName)) {
            acronyms.set(fullName, acronym);
          }
        }
      }
      match = pattern.exec(text);
    }
  }
  return acronyms;
}

export function extractAllAcronyms(texts: string[]): Map<string, string> {
  const allAcronyms = new Map<string, string>();
  for (const text of texts) {
    const found = extractAcronymsFromText(text);
    for (const [acronym, expansion] of found) {
      const existing = allAcronyms.get(acronym);
      if (!existing || expansion.length > existing.length) {
        allAcronyms.set(acronym, expansion);
      }
    }
  }
  return allAcronyms;
}

export function saveAcronymDictionary(acronyms: Map<string, string>, customPath?: string): void {
  const settings = getSettings();
  const filePath = customPath ?? join(settings.indexDir, "acronyms.json");
  const dict: Record<string, string[]> = {};
  for (const [acronym, expansion] of acronyms) {
    dict[acronym] = [expansion];
  }
  writeFileSync(filePath, JSON.stringify(dict, null, 2), "utf-8");
}

export function loadAcronymDictionary(customPath?: string): Map<string, string[]> {
  const settings = getSettings();
  const filePath = customPath ?? join(settings.indexDir, "acronyms.json");
  if (!existsSync(filePath)) {
    return new Map();
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    const dict: Record<string, string[]> = JSON.parse(content);
    const result = new Map<string, string[]>();
    for (const [acronym, expansions] of Object.entries(dict)) {
      result.set(acronym, expansions);
    }
    return result;
  } catch {
    return new Map();
  }
}

export function expandQueryWithAcronyms(
  query: string,
  dictionary: Map<string, string[]>,
  maxEditDistance = 1
): string {
  const terms = query.split(/\s+/);
  const expansions: string[] = [];
  for (const term of terms) {
    expansions.push(term);
    const exactMatch = dictionary.get(term.toUpperCase());
    if (exactMatch) {
      for (const expansion of exactMatch) {
        expansions.push(expansion);
      }
      continue;
    }
    if (maxEditDistance > 0) {
      for (const [acronym, defs] of dictionary) {
        if (levenshteinDistance(term.toUpperCase(), acronym) <= maxEditDistance) {
          for (const expansion of defs) {
            expansions.push(expansion);
          }
          break;
        }
      }
    }
  }
  return [...new Set(expansions)].join(" ");
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  const firstRow = matrix[0];
  if (firstRow) {
    for (let j = 0; j <= a.length; j++) {
      firstRow[j] = j;
    }
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const prevRow = matrix[i - 1];
      const currRow = matrix[i];
      if (!prevRow || !currRow) continue;
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        currRow[j] = prevRow[j - 1] ?? 0;
      } else {
        const substitution = (prevRow[j - 1] ?? 0) + 1;
        const insertion = (currRow[j - 1] ?? 0) + 1;
        const deletion = (prevRow[j] ?? 0) + 1;
        currRow[j] = Math.min(substitution, insertion, deletion);
      }
    }
  }
  const lastRow = matrix[b.length];
  return lastRow?.[a.length] ?? 0;
}
