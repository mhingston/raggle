import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const envPath = join(process.cwd(), ".env");
  try {
    const require = createRequire(import.meta.url);
    const dotenv = require("dotenv") as { config: (opts: { path: string }) => void };
    dotenv.config({ path: envPath });
    return;
  } catch {
    // Fallback to a minimal .env parser if dotenv can't be loaded.
  }

  try {
    const raw = readFileSync(envPath, "utf-8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env or unreadable; ignore.
  }
}

export function resetEnv(): void {
  loaded = false;
}
