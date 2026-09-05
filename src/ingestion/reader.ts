import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { FileInfo } from "../core/models";
import { matchesExclude, matchesExcludeDirectory } from "./exclude";

export type DiscoveryOptions = {
  exclude?: string[];
};

export async function discoverMarkdownFiles(
  directory: string,
  options: DiscoveryOptions = {}
): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  let rootRealPath = "";

  try {
    rootRealPath = await realpath(directory);
  } catch {
    return [];
  }

  const visitedDirs = new Set<string>();

  const isWithinRoot = (candidate: string): boolean => {
    if (candidate === rootRealPath) return true;
    return candidate.startsWith(`${rootRealPath}${sep}`);
  };

  async function walk(dir: string): Promise<void> {
    let dirRealPath = "";
    try {
      dirRealPath = await realpath(dir);
    } catch {
      return;
    }

    if (!isWithinRoot(dirRealPath)) {
      return;
    }

    if (visitedDirs.has(dirRealPath)) {
      return;
    }
    visitedDirs.add(dirRealPath);

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    entries.sort();

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      try {
        const stats = await lstat(fullPath);

        if (stats.isSymbolicLink()) {
          // Skip symlinked files; allow symlinked directories only if they resolve within root.
          let targetRealPath = "";
          try {
            targetRealPath = await realpath(fullPath);
          } catch {
            continue;
          }

          let targetStats: Awaited<ReturnType<typeof stat>>;
          try {
            targetStats = await stat(fullPath);
          } catch {
            continue;
          }

          if (targetStats.isDirectory() && isWithinRoot(targetRealPath)) {
            await walk(fullPath);
          }

          continue;
        }

        const relativePath = relative(rootRealPath, await realpath(fullPath));

        if (stats.isDirectory()) {
          if (matchesExcludeDirectory(relativePath, options.exclude)) continue;
          await walk(fullPath);
        } else if (stats.isFile() && extname(entry).toLowerCase() === ".md") {
          if (matchesExclude(relativePath, options.exclude)) continue;
          const content = await readFile(fullPath, "utf-8");
          const checksum = createHash("md5").update(content).digest("hex");

          const titleMatch = content.match(/^#\s+(.+)$/m);
          const title = titleMatch?.[1]?.trim() ?? basename(entry, ".md");

          files.push({
            path: fullPath,
            title,
            lastModified: stats.mtime,
            sizeBytes: stats.size,
            checksum,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  await walk(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readFileContent(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}
