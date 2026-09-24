import { describe, it, expect, afterEach } from "vitest";
import { isProtected, protectedError } from "../src/protect.js";

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

describe("protectedError", () => {
  it("is an error mentioning the operation and how to unlock", () => {
    const r = protectedError("Delete user");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Delete user");
    expect(r.content[0].text).toContain("CCX_PROTECT=false");
  });
});
