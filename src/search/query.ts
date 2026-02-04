import { expandQueryWithAcronyms, loadAcronymDictionary } from "../extraction/acronyms";
import { tokenize } from "../utils/text";

export function expandQuery(query: string, useFuzzy = true): string {
  const dictionary = loadAcronymDictionary();

  if (dictionary.size === 0) {
    return query;
  }

  const maxEditDistance = useFuzzy ? 1 : 0;
  return expandQueryWithAcronyms(query, dictionary, maxEditDistance);
}

export function preprocessQuery(query: string): string {
  // Normalize whitespace
  let processed = query.trim().replace(/\s+/g, " ");

  // Lowercase (for BM25 matching)
  processed = processed.toLowerCase();

  return processed;
}

export interface QueryAnalysis {
  original: string;
  expanded: string;
  tokens: string[];
  hasAcronyms: boolean;
  entityHints: string[];
}

export function analyzeQuery(query: string, expandedQuery?: string): QueryAnalysis {
  const expanded = expandedQuery ?? expandQuery(query);
  const tokens = tokenize(expanded);

  // Check for potential acronyms (2-5 uppercase letters)
  const acronymMatches = query.match(/\b[A-Z]{2,5}\b/g) || [];

  // Extract potential entity hints (capitalized words)
  const capitalizedWords = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];

  return {
    original: query,
    expanded,
    tokens: [...new Set(tokens)],
    hasAcronyms: acronymMatches.length > 0,
    entityHints: [...new Set(capitalizedWords)],
  };
}
