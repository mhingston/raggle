import { describe, test } from "node:test";
import { expect } from "expect";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, sep } from "path";
import { discoverMarkdownFiles } from "../src/ingestion/reader";
import { createTempIndexDir } from "./helpers";

describe("ingestion/reader", () => {
  test("discovers markdown files deterministically", async () => {
    const base = createTempIndexDir();
    const dir = join(base, "docs");
    mkdirSync(dir);
    writeFileSync(join(dir, "b.md"), "# B");
    writeFileSync(join(dir, "a.md"), "# A");

    const files = await discoverMarkdownFiles(dir);
    expect(files.map((f) => f.path.endsWith("a.md"))).toContain(true);
    expect(files[0]?.path.endsWith("a.md")).toBe(true);
  });

  test("returns empty list for missing directories", async () => {
    const files = await discoverMarkdownFiles("/tmp/does-not-exist-raggle");
    expect(files).toEqual([]);
  });

  test("allows in-tree symlinked directories and skips symlinked files/out-of-tree", async () => {
    const base = createTempIndexDir();
    const docsDir = join(base, "docs");
    const realDir = join(base, "real");
    mkdirSync(docsDir);
    mkdirSync(realDir);

    writeFileSync(join(realDir, "inside.md"), "# Inside");

    let canSymlink = true;
    try {
      symlinkSync(realDir, join(docsDir, "link"));
    } catch {
      canSymlink = false;
    }

    if (!canSymlink) return;

    const outsideDir = mkdtempSync(join(tmpdir(), "raggle-outside-"));
    writeFileSync(join(outsideDir, "outside.md"), "# Outside");
    try {
      symlinkSync(outsideDir, join(docsDir, "outside-link"));
    } catch {
      // If we can't create the out-of-tree symlink, we can still validate in-tree behavior.
    }

    const fileTarget = join(realDir, "file.md");
    writeFileSync(fileTarget, "# File");
    try {
      symlinkSync(fileTarget, join(docsDir, "file-link.md"));
    } catch {
      // Ignore if symlink creation fails; other assertions still hold.
    }

    const files = await discoverMarkdownFiles(base);
    const paths = files.map((f) => f.path);

    expect(paths.some((p) => p.includes(`docs${sep}link${sep}inside.md`))).toBe(true);
    expect(paths.some((p) => p.endsWith(`outside.md`))).toBe(false);
    expect(paths.some((p) => p.endsWith(`${sep}file-link.md`))).toBe(false);
  });
});
