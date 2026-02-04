import { describe, test } from "node:test";
import { expect } from "expect";
import { getSettings, resetSettings } from "../src/core/config";

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

describe("core/config", () => {
  test("handles invalid numbers and booleans", () => {
    withEnv(
      {
        RAGGLE_RERANK_SCORE_THRESHOLD: "nope",
        RAGGLE_READ_ONLY: "1",
      },
      () => {
        const settings = getSettings();
        expect(settings.rerankerScoreThreshold).toBe(-8.0);
        expect(settings.readOnly).toBe(true);
      }
    );
  });
});
