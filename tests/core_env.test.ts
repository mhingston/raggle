import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, resetEnv } from "../src/core/env";

describe("core/env", () => {
  test("loads .env from current working directory", () => {
    const prevCwd = process.cwd();
    const prevEnv = { ...process.env };
    const dir = mkdtempSync(join(tmpdir(), "raggle-env-test-"));
    const envPath = join(dir, ".env");

    try {
      delete process.env.RAGGLE_INDEX_DIR;
      delete process.env.RAGGLE_EMBEDDING_MODEL;

      writeFileSync(
        envPath,
        "RAGGLE_INDEX_DIR=/tmp/raggle-env-test\nRAGGLE_EMBEDDING_MODEL=env-model\n",
        "utf-8"
      );

      process.chdir(dir);
      resetEnv();
      loadEnv();

      expect(process.env.RAGGLE_INDEX_DIR).toBe("/tmp/raggle-env-test");
      expect(process.env.RAGGLE_EMBEDDING_MODEL).toBe("env-model");
    } finally {
      process.chdir(prevCwd);
      process.env = prevEnv;
      resetEnv();
    }
  });
});
