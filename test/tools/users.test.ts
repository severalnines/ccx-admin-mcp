import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { msw, API, loginHandler, requireSession, setEnv, connectTools, type ToolCaller } from "../helpers.js";
import { clearSession } from "../../src/auth.js";
import users from "../fixtures/users.json";

let tools: ToolCaller;

beforeAll(async () => {
  msw.listen({ onUnhandledRequest: "error" });
  tools = await connectTools();
});
afterAll(async () => {
  await tools.close();
  msw.close();
});
beforeEach(() => {
  clearSession();
  setEnv({ session: true, basic: false });
  msw.use(
    loginHandler(),
    http.get(`${API}/admin/users`, ({ request }) => requireSession(request) ?? HttpResponse.json(users)),
  );
});
afterEach(() => msw.resetHandlers());

describe("ccx_admin_list_users", () => {
  it("lists users with totals", async () => {
    const j = (await tools.call("ccx_admin_list_users")).json() as any;
    expect(j).toMatchObject({ total: 3, suspended: 1, deleted: 1 });
    expect(j.users.map((u: any) => u.login)).toEqual(["alice@example.com", "bob@example.com", "gone@example.com"]);
  });

  it("filters by suspended/deleted flags and login/name substrings", async () => {
    const susp = (await tools.call("ccx_admin_list_users", { suspended: true })).json() as any;
    expect(susp.users.map((u: any) => u.id)).toEqual(["u-2"]);
    const live = (await tools.call("ccx_admin_list_users", { deleted: false })).json() as any;
    expect(live.users.map((u: any) => u.id)).toEqual(["u-1", "u-2"]);
    const byLogin = (await tools.call("ccx_admin_list_users", { login: "GONE" })).json() as any;
    expect(byLogin.users.map((u: any) => u.id)).toEqual(["u-3"]);
    const byName = (await tools.call("ccx_admin_list_users", { name: "bob" })).json() as any;
    expect(byName.users.map((u: any) => u.id)).toEqual(["u-2"]);
  });

  it("paginates", async () => {
    const p = (await tools.call("ccx_admin_list_users", { limit: 2, offset: 2 })).json() as any;
    expect(p.users.map((u: any) => u.id)).toEqual(["u-3"]);
    expect(p.pagination).toMatchObject({ matched: 3, returned: 1, has_more: false });
  });
});

describe("ccx_admin_suspend_user", () => {
  it("is blocked by protection mode", async () => {
    let called = false;
    msw.use(http.post(`${API}/admin/users/:id`, () => { called = true; return HttpResponse.json({}); }));
    const r = await tools.call("ccx_admin_suspend_user", { user_id: "u-1", reason: "abuse" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/BLOCKED/);
    expect(called).toBe(false);
  });

  it("posts {suspend:{reason}} when unprotected", async () => {
    setEnv({ session: true, protect: "false" });
    let body: unknown;
    msw.use(http.post(`${API}/admin/users/u-1`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }));
    const r = await tools.call("ccx_admin_suspend_user", { user_id: "u-1", reason: "abuse" });
    expect(r.isError).toBe(false);
    expect(body).toEqual({ suspend: { reason: "abuse" } });
    expect(r.json()).toMatchObject({ user_id: "u-1", suspended: true });
  });

  it("requires a reason", async () => {
    setEnv({ session: true, protect: "false" });
    const r = await tools.call("ccx_admin_suspend_user", { user_id: "u-1", reason: "" });
    expect(r.isError).toBe(true);
  });
});

describe("ccx_admin_unsuspend_user", () => {
  it("posts {unsuspend:{}} and is not protected", async () => {
    let body: unknown;
    msw.use(http.post(`${API}/admin/users/u-2`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }));
    const r = await tools.call("ccx_admin_unsuspend_user", { user_id: "u-2" });
    expect(r.isError).toBe(false);
    expect(body).toEqual({ unsuspend: {} });
  });

  it("reports backend 400 errors", async () => {
    msw.use(http.post(`${API}/admin/users/u-2`, () => HttpResponse.json({ error: "user not suspended" }, { status: 400 })));
    const r = await tools.call("ccx_admin_unsuspend_user", { user_id: "u-2" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/400/);
  });
});

describe("ccx_admin_delete_user", () => {
  it("is blocked by protection mode", async () => {
    const r = await tools.call("ccx_admin_delete_user", { user_id: "u-3", confirm: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/BLOCKED/);
  });

  it("requires confirm=true", async () => {
    setEnv({ session: true, protect: "false" });
    let called = false;
    msw.use(http.delete(`${API}/admin/users/:id`, () => { called = true; return HttpResponse.json({ deleted: true }); }));
    const r = await tools.call("ccx_admin_delete_user", { user_id: "u-3", confirm: false });
    expect(r.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("deletes when unprotected and confirmed", async () => {
    setEnv({ session: true, protect: "false" });
    msw.use(http.delete(`${API}/admin/users/u-3`, () => HttpResponse.json({ deleted: true })));
    const r = await tools.call("ccx_admin_delete_user", { user_id: "u-3", confirm: true });
    expect(r.isError).toBe(false);
    expect(r.json()).toEqual({ user_id: "u-3", deleted: true });
  });
});
