import { describe, it, expect, afterEach } from "vitest";
import { isProtected } from "../src/protect.js";
import { connectTools } from "./helpers.js";

describe("isProtected", () => {
  afterEach(() => delete process.env.CCX_PROTECT);

  it.each([
    [undefined, true],
    ["true", true],
    ["yes", true],
    ["false", false],
    ["FALSE", false],
    ["0", false],
  ])("CCX_PROTECT=%s -> %s", (val, expected) => {
    if (val === undefined) delete process.env.CCX_PROTECT;
    else process.env.CCX_PROTECT = val;
    expect(isProtected()).toBe(expected);
  });
});

const DESTRUCTIVE = ["ccx_admin_delete_datastore", "ccx_admin_delete_user", "ccx_admin_suspend_user"];

describe("registerAllTools", () => {
  it("leaves the destructive tools out while protected", async () => {
    const t = await connectTools({ protect: true });
    const names = await t.listTools();
    await t.close();
    for (const name of DESTRUCTIVE) expect(names).not.toContain(name);
    expect(names).toHaveLength(12);
  });

  it("registers them when unprotected", async () => {
    const t = await connectTools({ protect: false });
    const names = await t.listTools();
    await t.close();
    for (const name of DESTRUCTIVE) expect(names).toContain(name);
    expect(names).toHaveLength(15);
  });
});
