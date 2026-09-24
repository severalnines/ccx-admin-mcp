import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse the contents of a dotenv file into key/value pairs.
 *
 * Supports `KEY=value`, `export KEY=value`, blank lines, `#` comments and
 * single- or double-quoted values. Anything else is ignored. No variable
 * expansion is performed.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // strip trailing inline comment
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * Candidate .env locations, in priority order: an explicit path, the current
 * working directory, then the package root (so a checkout with a .env next to
 * package.json works no matter where the MCP client starts the process).
 */
export function envFileCandidates(explicit?: string): string[] {
  const candidates: string[] = [];
  if (explicit) candidates.push(resolve(explicit));
  candidates.push(resolve(process.cwd(), ".env"));
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // build/env.js -> package root; src/env.ts -> package root
    candidates.push(resolve(here, "..", ".env"));
  } catch {
    // import.meta.url unavailable (bundled) — skip
  }
  return [...new Set(candidates)];
}

/**
 * Load the first existing .env file into process.env. Only CCX_* keys are
 * imported, so a .env belonging to some other project in the working
 * directory cannot inject unrelated variables. Existing environment variables
 * are never overwritten. Returns the path that was loaded, or null.
 */
export function loadDotenv(explicit?: string): string | null {
  for (const path of envFileCandidates(explicit)) {
    if (!existsSync(path)) {
      if (explicit && path === resolve(explicit)) {
        throw new Error(`env file not found: ${path}`);
      }
      continue;
    }
    const parsed = parseDotenv(readFileSync(path, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.startsWith("CCX_")) continue;
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
    return path;
  }
  return null;
}
