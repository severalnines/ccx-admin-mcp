import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { msw, API, BASIC, SESSION, loginHandler, setEnv } from "./helpers.js";
import { clearSession } from "../src/auth.js";
import { get, post, ApiError, AuthConfigError } from "../src/client.js";

beforeAll(() => msw.listen({ onUnhandledRequest: "error" }));
afterAll(() => msw.close());
beforeEach(() => {
  clearSession();
  setEnv({ session: true, basic: true });
});
afterEach(() => msw.resetHandlers());

describe("session auth", () => {
  it("logs in lazily on first request and sends the cookie", async () => {
    const counter = { logins: 0 };
    let cookie: string | null = null;
    msw.use(
      loginHandler(counter),
      http.get(`${API}/admin/cmon/version`, ({ request }) => {
        cookie = request.headers.get("cookie");
        return HttpResponse.json({ cmon_version: "2.4.0" });
      }),
    );
    await get("/admin/cmon/version");
    await get("/admin/cmon/version");
    expect(counter.logins).toBe(1);
    expect(cookie).toBe(SESSION);
  });

  it("re-logs in once on 401 and retries", async () => {
    const counter = { logins: 0 };
    let calls = 0;
    msw.use(
      loginHandler(counter),
      http.get(`${API}/admin/users`, () => {
        calls++;
        if (calls === 1) return HttpResponse.json({ error: "session expired" }, { status: 401 });
        return HttpResponse.json({ users: [] });
      }),
    );
    const r = (await get("/admin/users")) as { users: unknown[] };
    expect(r.users).toEqual([]);
    expect(calls).toBe(2);
    expect(counter.logins).toBe(2);
  });

  it("does not retry forever on a persistent 401", async () => {
    let calls = 0;
    msw.use(
      loginHandler(),
      http.get(`${API}/admin/users`, () => {
        calls++;
        return HttpResponse.json({ error: "unauthorized" }, { status: 401 });
      }),
    );
    await expect(get("/admin/users")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(2);
  });

  it("surfaces a bad admin password as a login error", async () => {
    process.env.CCX_ADMIN_PASSWORD = "wrong";
    msw.use(loginHandler());
    await expect(get("/admin/users")).rejects.toThrow(/Admin login failed \(401\)/);
  });

  it("wraps API errors with status, path and body", async () => {
    msw.use(
      loginHandler(),
      http.get(`${API}/admin/datastores/nope`, () =>
        HttpResponse.json({ err: "rpc error: code = NotFound desc = datastore not found" }, { status: 500 }),
      ),
    );
    await expect(get("/admin/datastores/nope")).rejects.toThrow(
      /API error 500 on \/admin\/datastores\/nope: .*datastore not found/,
    );
  });

  it("sends JSON bodies and query params", async () => {
    let body: unknown;
    let query = "";
    msw.use(
      loginHandler(),
      http.post(`${API}/admin/users/u-1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
      http.get(`${API}/admin/datastores/ds/audit`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({ lines: [] });
      }),
    );
    await post("/admin/users/u-1", { body: { suspend: { reason: "abuse" } } });
    await get("/admin/datastores/ds/audit", { params: { limit: "5", from: undefined, to: "" } });
    expect(body).toEqual({ suspend: { reason: "abuse" } });
    expect(query).toBe("?limit=5");
  });
});

describe("basic auth", () => {
  it("sends an Authorization: Basic header and never logs in", async () => {
    let auth: string | null = null;
    msw.use(
      http.get(`${API}/admin/check`, ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ success: true });
      }),
    );
    await get("/admin/check", { auth: "basic" });
    expect(auth).toBe(BASIC);
  });

  it("does not retry a basic-auth 401", async () => {
    let calls = 0;
    msw.use(
      http.get(`${API}/admin/check`, () => {
        calls++;
        return new HttpResponse(null, { status: 401 });
      }),
    );
    await expect(get("/admin/check", { auth: "basic" })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });
});

describe("auth mode resolution", () => {
  it("rejects session endpoints when only basic creds exist", async () => {
    setEnv({ session: false, basic: true });
    await expect(get("/admin/users")).rejects.toBeInstanceOf(AuthConfigError);
  });

  it("rejects basic endpoints when only session creds exist", async () => {
    setEnv({ session: true, basic: false });
    await expect(get("/admin/check", { auth: "basic" })).rejects.toBeInstanceOf(AuthConfigError);
  });

  it("'any' prefers the session and falls back to basic", async () => {
    let auth: string | null = null;
    let cookie: string | null = null;
    msw.use(
      loginHandler(),
      http.get(`${API}/admin/datastores/billing/usage/json`, ({ request }) => {
        auth = request.headers.get("authorization");
        cookie = request.headers.get("cookie");
        return HttpResponse.json({ datastores: [] });
      }),
    );
    await get("/admin/datastores/billing/usage/json", { auth: "any" });
    expect(cookie).toBe(SESSION);
    expect(auth).toBeNull();

    setEnv({ session: false, basic: true });
    await get("/admin/datastores/billing/usage/json", { auth: "any" });
    expect(auth).toBe(BASIC);
  });

  it("'any' fails clearly with no credentials at all", async () => {
    setEnv({ session: false, basic: false });
    await expect(get("/admin/datastores/billing/usage/json", { auth: "any" })).rejects.toThrow(
      /No admin credentials configured/,
    );
  });
});
