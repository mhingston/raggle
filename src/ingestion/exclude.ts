import { basename, posix } from "node:path";

function normalisePattern(pattern: string): string {
  let value = pattern.trim().replaceAll("\\", "/");
  value = value.replace(/^\.\//, "").replace(/^\//, "");
  if (value.endsWith("/")) value += "**";
  return value;
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const character = pattern[i];
    if (!character) break;
    if (character === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          source += "(?:.*/)?";
          i += 1;
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** Return true when a root-relative POSIX path matches an exclude glob. */
export function matchesExclude(relativePath: string, patterns: string[] = []): boolean {
  const path = posix.normalize(relativePath.replaceAll("\\", "/")).replace(/^\.\//, "");
  return patterns.some((rawPattern) => {
    const pattern = normalisePattern(rawPattern);
    if (!pattern) return false;
    const expression = globToRegExp(pattern);
    if (pattern.includes("/")) return expression.test(path);
    return expression.test(basename(path));
  });
}

/** Return true when a directory itself and everything below it is excluded. */
export function matchesExcludeDirectory(relativePath: string, patterns: string[] = []): boolean {
  const path = posix.normalize(relativePath.replaceAll("\\", "/")).replace(/^\.\//, "");
  return patterns.some((rawPattern) => {
    const pattern = normalisePattern(rawPattern);
    if (!pattern) return false;
    if (matchesExclude(path, [pattern])) return true;
    if (!pattern.endsWith("/**")) return false;
    return globToRegExp(pattern.slice(0, -3)).test(path);
  });
}
