import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotenv, loadDotenv, envFileCandidates, packageRoot } from "../src/env.js";

describe("parseDotenv", () => {
  it("parses plain, quoted, exported and commented lines", () => {
    const parsed = parseDotenv(`
# comment
CCX_BASE_URL=https://ccx.example.com
export CCX_ADMIN_USERNAME=admin@example.com
CCX_ADMIN_PASSWORD="p#ss word"
SINGLE='x y'
INLINE=value # trailing comment
QUOTED_COMMENT="p#ss" # staging
EMPTY=
not a valid line
`);
    expect(parsed).toEqual({
      CCX_BASE_URL: "https://ccx.example.com",
      CCX_ADMIN_USERNAME: "admin@example.com",
      CCX_ADMIN_PASSWORD: "p#ss word",
      SINGLE: "x y",
      INLINE: "value",
      QUOTED_COMMENT: "p#ss",
      EMPTY: "",
    });
  });
});

describe("loadDotenv", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    delete process.env.CCX_DOTENV_TEST_A;
    delete process.env.CCX_DOTENV_TEST_B;
    delete process.env.OTHER_DOTENV_TEST;
  });

  function tmpEnv(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "ccx-admin-mcp-"));
    dirs.push(dir);
    const path = join(dir, ".env");
    writeFileSync(path, content);
    return path;
  }

  it("loads an explicit file and does not override existing env vars", () => {
    process.env.CCX_DOTENV_TEST_A = "from-env";
    const path = tmpEnv("CCX_DOTENV_TEST_A=from-file\nCCX_DOTENV_TEST_B=from-file\n");
    expect(loadDotenv(path)).toBe(path);
    expect(process.env.CCX_DOTENV_TEST_A).toBe("from-env");
    expect(process.env.CCX_DOTENV_TEST_B).toBe("from-file");
  });

  it("ignores keys that are not CCX_*", () => {
    const path = tmpEnv("OTHER_DOTENV_TEST=leak\nCCX_DOTENV_TEST_B=ok\n");
    loadDotenv(path);
    expect(process.env.OTHER_DOTENV_TEST).toBeUndefined();
    expect(process.env.CCX_DOTENV_TEST_B).toBe("ok");
  });

  it("throws when the explicit file is missing", () => {
    expect(() => loadDotenv("/nonexistent/dir/.env")).toThrow(/env file not found/);
  });

  it("searches the explicit path, then the package root, and never the working directory", () => {
    const expectedRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
    expect(packageRoot()).toBe(expectedRoot);
    expect(envFileCandidates()).toEqual([join(expectedRoot, ".env")]);
    expect(envFileCandidates("/x/.env")).toEqual(["/x/.env", join(expectedRoot, ".env")]);
    expect(envFileCandidates()).toEqual([join(expectedRoot, ".env")]);
    // even if cwd differs from the package root it must not be consulted
    const cwd = process.cwd();
    process.chdir(tmpdir());
    try {
      expect(envFileCandidates()).toEqual([join(expectedRoot, ".env")]);
    } finally {
      process.chdir(cwd);
    }
  });
});
