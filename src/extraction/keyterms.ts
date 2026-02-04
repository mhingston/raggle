import type { Entity, ExtractionResult } from "../core/models";
import { isNoiseToken, tokenize } from "../utils/text";
import { extractHeadings } from "./structural";

interface TermFrequency {
  term: string;
  count: number;
  documentCount: number;
}

const MIN_TERM_LENGTH = 3;

function extractNgrams(tokens: string[], maxN: number): string[] {
  const ngrams: string[] = [];
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.push(tokens.slice(i, i + n).join(" "));
    }
  }
  return ngrams;
}

export function computeTFIDF(
  documents: string[],
  maxTerms: number = 20
): Array<{ term: string; score: number }> {
  const docCount = documents.length;
  const termFrequencies: Map<string, TermFrequency> = new Map();
  const docFrequencies: Map<string, number> = new Map();

  for (let docIdx = 0; docIdx < documents.length; docIdx++) {
    const doc = documents[docIdx];
    if (!doc) continue;
    const tokens = tokenize(doc).filter((t) => t.length >= MIN_TERM_LENGTH);
    const ngrams = extractNgrams(tokens, 3);
    const seenInDoc = new Set<string>();

    for (const term of ngrams) {
      const tf = termFrequencies.get(term);
      if (tf) {
        tf.count++;
      } else {
        termFrequencies.set(term, { term, count: 1, documentCount: 0 });
      }
      if (!seenInDoc.has(term)) {
        seenInDoc.add(term);
        docFrequencies.set(term, (docFrequencies.get(term) || 0) + 1);
      }
    }

    for (const term of seenInDoc) {
      const tf = termFrequencies.get(term);
      if (tf) {
        tf.documentCount++;
      }
    }
  }

  const scores: Array<{ term: string; score: number }> = [];
  for (const [term, tf] of termFrequencies) {
    const df = docFrequencies.get(term) ?? 1;
    const idf = Math.log(docCount / df);
    const tfidf = tf.count * idf;
    scores.push({ term, score: tfidf });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, maxTerms);
}

/**
 * Precompute corpus statistics for efficient TF-IDF calculation.
 * Returns document frequencies for all terms across the corpus.
 */
export function precomputeCorpusStats(documents: string[]): Map<string, number> {
  const docFrequencies: Map<string, number> = new Map();

  for (const doc of documents) {
    if (!doc) continue;
    const tokens = tokenize(doc).filter((t) => t.length >= MIN_TERM_LENGTH);
    const ngrams = extractNgrams(tokens, 3);
    const seenInDoc = new Set<string>();

    for (const term of ngrams) {
      if (!seenInDoc.has(term)) {
        seenInDoc.add(term);
        docFrequencies.set(term, (docFrequencies.get(term) || 0) + 1);
      }
    }
  }

  return docFrequencies;
}

/**
 * Compute TF-IDF for a single document using precomputed corpus statistics.
 * Much more efficient than computeTFIDF when processing many documents.
 */
export function computeTFIDFForDocument(
  content: string,
  docFrequencies: Map<string, number>,
  totalDocs: number,
  maxTerms: number = 10
): Array<{ term: string; score: number }> {
  const tokens = tokenize(content).filter((t) => t.length >= MIN_TERM_LENGTH);
  const ngrams = extractNgrams(tokens, 3);
  const termCounts: Map<string, number> = new Map();

  for (const term of ngrams) {
    termCounts.set(term, (termCounts.get(term) || 0) + 1);
  }

  const scores: Array<{ term: string; score: number }> = [];
  for (const [term, count] of termCounts) {
    const df = docFrequencies.get(term) ?? 1;
    const idf = Math.log(totalDocs / df);
    const tfidf = count * idf;
    scores.push({ term, score: tfidf });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, maxTerms);
}

export function extractKeyTerms(
  content: string,
  chunkId: string,
  allDocuments: string[]
): ExtractionResult {
  const entities: Entity[] = [];
  const headings = extractHeadings(content);
  for (const heading of headings) {
    const words = tokenize(heading.text).filter((w) => w.length >= MIN_TERM_LENGTH);
    for (const word of words) {
      entities.push({
        name: word,
        type: "keyterm",
        source: "keyterm",
        chunkIds: [chunkId],
      });
    }
  }

  // For single-chunk calls (backward compatibility), use the old method
  // For batch processing, use precomputeCorpusStats + computeTFIDFForDocument
  const tfidfTerms = computeTFIDF([content, ...allDocuments], 10);
  for (const { term } of tfidfTerms) {
    if (term.length >= MIN_TERM_LENGTH && !isNoiseToken(term)) {
      entities.push({
        name: term,
        type: "keyterm",
        source: "keyterm",
        chunkIds: [chunkId],
      });
    }
  }

  return { entities, relations: [] };
}

/**
 * Optimized version of extractKeyTerms that uses precomputed corpus statistics.
 * O(N) instead of O(N^2) when processing many chunks.
 *
 * Note: To match the original behavior where the current chunk is included in the corpus,
 * the caller should pass totalDocs as (corpusSize + 1) and include the current chunk's
 * term frequencies in docFrequencies by calling precomputeCorpusStats on the full
 * corpus including the current chunk, or by manually incrementing docFrequencies for
 * terms in the current chunk.
 */
export function extractKeyTermsWithStats(
  content: string,
  chunkId: string,
  docFrequencies: Map<string, number>,
  totalDocs: number
): ExtractionResult {
  const entities: Entity[] = [];
  const headings = extractHeadings(content);
  for (const heading of headings) {
    const words = tokenize(heading.text).filter((w) => w.length >= MIN_TERM_LENGTH);
    for (const word of words) {
      entities.push({
        name: word,
        type: "keyterm",
        source: "keyterm",
        chunkIds: [chunkId],
      });
    }
  }

  const tfidfTerms = computeTFIDFForDocument(content, docFrequencies, totalDocs, 10);
  for (const { term } of tfidfTerms) {
    if (term.length >= MIN_TERM_LENGTH && !isNoiseToken(term)) {
      entities.push({
        name: term,
        type: "keyterm",
        source: "keyterm",
        chunkIds: [chunkId],
      });
    }
  }

  return { entities, relations: [] };
}

export function extractHeadingTerms(content: string, chunkId: string): Entity[] {
  const entities: Entity[] = [];
  const headings = extractHeadings(content);
  for (const heading of headings) {
    entities.push({
      name: heading.text,
      type: "heading",
      source: "keyterm",
      chunkIds: [chunkId],
    });
  }
  return entities;
}
