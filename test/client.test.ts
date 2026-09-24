import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { msw, API, BASIC, SESSION, loginHandler, setEnv } from "./helpers.js";
import { clearSession } from "../src/auth.js";
import { get, post, del, ApiError, AuthConfigError } from "../src/client.js";
import { getBaseUrl } from "../src/auth.js";

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

  it("does not replay a mutation after a 401, but resets the session and says so", async () => {
    const counter = { logins: 0 };
    let calls = 0;
    msw.use(
      loginHandler(counter),
      http.delete(`${API}/admin/users/u-1`, () => {
        calls++;
        return HttpResponse.json({ error: "session expired" }, { status: 401 });
      }),
    );
    await expect(del("/admin/users/u-1")).rejects.toThrow(/401.*session was rejected/);
    expect(calls).toBe(1);
    expect(counter.logins).toBe(1);
    // the next call logs in again with a fresh session
    msw.use(http.get(`${API}/admin/users`, () => HttpResponse.json({ users: [] })));
    await get("/admin/users");
    expect(counter.logins).toBe(2);
  });

  it("shares one login between concurrent first requests", async () => {
    const counter = { logins: 0 };
    msw.use(
      loginHandler(counter),
      http.get(`${API}/admin/users`, () => HttpResponse.json({ users: [] })),
      http.get(`${API}/admin/datastores`, () => HttpResponse.json({ clusters: [] })),
    );
    await Promise.all([get("/admin/users"), get("/admin/datastores"), get("/admin/users")]);
    expect(counter.logins).toBe(1);
  });

  it("treats a non-JSON 200 as an error instead of empty data", async () => {
    msw.use(
      loginHandler(),
      http.get(`${API}/admin/datastores`, () => new HttpResponse("<html>maintenance</html>", { status: 200, headers: { "Content-Type": "text/html" } })),
    );
    await expect(get("/admin/datastores")).rejects.toThrow(/expected JSON but got text\/html/);
  });

  it("issues the login request with redirects refused", async () => {
    // msw's interceptor cannot follow a redirected POST at all, so a mocked
    // redirect proves nothing here; assert the fetch option itself instead.
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      msw.use(loginHandler(), http.get(`${API}/admin/users`, () => HttpResponse.json({ users: [] })));
      await get("/admin/users");
      const loginCall = spy.mock.calls.find(([url]) => String(url).endsWith("/api/auth/admin-login"));
      expect(loginCall, "login request").toBeDefined();
      expect((loginCall![1] as RequestInit).redirect).toBe("error");
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses to follow a redirect on an API call, even to a working target", async () => {
    let targetHit = false;
    msw.use(
      loginHandler(),
      http.get(`${API}/admin/users`, () => new HttpResponse(null, { status: 302, headers: { Location: "https://evil.example/" } })),
      http.get("https://evil.example/", () => {
        targetHit = true;
        return HttpResponse.json({ users: [] });
      }),
    );
    await expect(get("/admin/users")).rejects.toThrow(/GET .* failed/);
    expect(targetHit).toBe(false);
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

  it("'any' falls back to basic when the session login is rejected", async () => {
    setEnv({ session: true, basic: true });
    process.env.CCX_ADMIN_PASSWORD = "wrong";
    let auth: string | null = null;
    msw.use(
      loginHandler(),
      http.get(`${API}/admin/datastores/billing/usage/json`, ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ datastores: [] });
      }),
    );
    await get("/admin/datastores/billing/usage/json", { auth: "any" });
    expect(auth).toBe(BASIC);
  });

  it("'any' falls back to basic when the session is rejected with 401", async () => {
    setEnv({ session: true, basic: true });
    const seen: string[] = [];
    msw.use(
      loginHandler(),
      http.get(`${API}/admin/datastores/billing/usage/json`, ({ request }) => {
        if (request.headers.get("cookie")) {
          seen.push("session");
          return HttpResponse.json({ error: "unauthorized" }, { status: 401 });
        }
        seen.push("basic");
        return HttpResponse.json({ datastores: [] });
      }),
    );
    await get("/admin/datastores/billing/usage/json", { auth: "any" });
    expect(seen).toEqual(["session", "session", "basic"]);
  });

  it("'any' does not fall back on a non-auth failure", async () => {
    setEnv({ session: true, basic: true });
    let calls = 0;
    msw.use(
      loginHandler(),
      http.get(`${API}/admin/datastores/billing/usage/json`, () => {
        calls++;
        return HttpResponse.json({ err: "boom" }, { status: 500 });
      }),
    );
    await expect(get("/admin/datastores/billing/usage/json", { auth: "any" })).rejects.toThrow(/500/);
    expect(calls).toBe(1);
  });

  it("'any' fails clearly with no credentials at all", async () => {
    setEnv({ session: false, basic: false });
    await expect(get("/admin/datastores/billing/usage/json", { auth: "any" })).rejects.toThrow(
      /No admin credentials configured/,
    );
  });
});

describe("base URL validation", () => {
  it.each([
    ["https://ccx.example.com", "https://ccx.example.com"],
    ["https://ccx.example.com/", "https://ccx.example.com"],
    ["https://ccx.example.com/sub/", "https://ccx.example.com/sub"],
    ["http://localhost:8080", "http://localhost:8080"],
    ["http://127.0.0.1:8080/", "http://127.0.0.1:8080"],
  ])("accepts %s", (input, expected) => {
    process.env.CCX_BASE_URL = input;
    expect(getBaseUrl()).toBe(expected);
  });

  it.each([
    ["http://ccx.example.com", /https:\/\//],
    ["https://user:pw@ccx.example.com", /credentials/],
    ["https://ccx.example.com/?x=1", /query/],
    ["ccx.example.com", /not a valid URL/],
    ["ftp://ccx.example.com", /https:\/\//],
  ])("rejects %s", (input, pattern) => {
    process.env.CCX_BASE_URL = input;
    expect(() => getBaseUrl()).toThrow(pattern);
  });
});
