import { describe, expect, test } from "bun:test";
import {
  cleanText,
  estimateTokens,
  isNoiseToken,
  splitSentences,
  tokenize,
} from "../src/utils/text";

describe("utils/text", () => {
  test("isNoiseToken handles stopwords, skip-upper, and hex", () => {
    expect(isNoiseToken("the")).toBe(true);
    expect(isNoiseToken("CSS")).toBe(true);
    expect(isNoiseToken("ff6b6b")).toBe(true);
    expect(isNoiseToken("Quantum")).toBe(false);
  });

  test("tokenize filters noise and preserves words", () => {
    const tokens = tokenize("The quick CSS fox jumps over ff6b6b tokens");
    expect(tokens).toEqual(["quick", "css", "fox", "jumps", "tokens"]);
  });

  test("estimateTokens uses floor with min 1", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  test("cleanText trims and collapses blanks", () => {
    const input = "line1  \n\n\nline2\n";
    expect(cleanText(input)).toBe("line1\n\nline2");
  });

  test("splitSentences respects capitalization", () => {
    const sentences = splitSentences("First sentence. Second starts. third lower.");
    expect(sentences).toEqual(["First sentence.", "Second starts. third lower."]);
  });
});
