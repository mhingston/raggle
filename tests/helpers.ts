import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetSettings } from "../src/core/config";
import { resetGraphStore, resetMetadataStore, resetVectorStore } from "../src/storage";

export function createTempIndexDir(prefix = "raggle-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.RAGGLE_INDEX_DIR = dir;
  resetSettings();
  resetMetadataStore();
  resetVectorStore();
  resetGraphStore();
  return dir;
}

export function resetAllStores(): void {
  resetSettings();
  resetMetadataStore();
  resetVectorStore();
  resetGraphStore();
}
