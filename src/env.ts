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
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : null;
    const close = quote ? value.indexOf(quote, 1) : -1;
    if (quote && close > 0) {
      value = value.slice(1, close);
    } else {
      // unquoted: strip trailing inline comment
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }
    out[m[1]] = value;
  }
  return out;
}

/** Directory containing package.json, or null when not running from a file: URL (bundled). */
export function packageRoot(): string | null {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return null;
  }
}

/**
 * Candidate .env locations: an explicit path, then the package root. The
 * process working directory is deliberately NOT searched: MCP clients start
 * servers inside arbitrary project directories, and a .env found there could
 * turn protection off or point the credentials at another endpoint.
 */
export function envFileCandidates(explicit?: string): string[] {
  const candidates: string[] = [];
  if (explicit) candidates.push(resolve(explicit));
  const root = packageRoot();
  if (root) candidates.push(resolve(root, ".env"));
  return [...new Set(candidates)];
}

/**
 * Load the first existing .env file into process.env. Only CCX_* keys are
 * imported, and existing environment variables are never overwritten.
 * Returns the path that was loaded, or null.
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
