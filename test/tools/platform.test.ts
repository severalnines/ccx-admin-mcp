import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { msw, API, loginHandler, requireBasic, requireSession, setEnv, connectTools, type ToolCaller } from "../helpers.js";
import { clearSession } from "../../src/auth.js";
import datastores from "../fixtures/datastores.json";
import users from "../fixtures/users.json";
import authcheck from "../fixtures/authcheck.json";
import billing from "../fixtures/billing.json";

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
  setEnv({ session: true, basic: true });
  msw.use(
    loginHandler(),
    http.get(`${API}/admin/check`, ({ request }) => requireBasic(request) ?? HttpResponse.json({ success: true })),
    http.get(`${API}/admin/datastores/count`, ({ request }) => requireBasic(request) ?? HttpResponse.json({ count: 10 })),
    http.get(`${API}/admin/users/count`, ({ request }) => requireBasic(request) ?? HttpResponse.json({ count: 7 })),
    http.get(`${API}/admin/vpcs/:region/all`, ({ request, params }) =>
      requireBasic(request) ??
      HttpResponse.json({ region: params.region, aws_num_vpcs: 0, ccx_num_vpcs: 1, aws_vpc_ids: null, ccx_vpc_ids: ["vpc-1"], aws_dangling_vpc_ids: null, ccx_dangling_vpc_ids: null }),
    ),
    http.get(`${API}/admin/cmon/version`, ({ request }) => requireSession(request) ?? HttpResponse.json({ cmon_version: "2.4.0.24243" })),
    http.get(`${API}/auth/check`, ({ request }) => requireSession(request) ?? HttpResponse.json(authcheck)),
    http.get(`${API}/admin/datastores`, ({ request }) => requireSession(request) ?? HttpResponse.json(datastores)),
    http.get(`${API}/admin/users`, ({ request }) => requireSession(request) ?? HttpResponse.json(users)),
    http.get(`${API}/admin/datastores/billing/usage/json`, ({ request }) => {
      if (requireSession(request) === null || requireBasic(request) === null) return HttpResponse.json(billing);
      return HttpResponse.json({ code: 401 }, { status: 401 });
    }),
  );
});
afterEach(() => msw.resetHandlers());

describe("ccx_admin_check", () => {
  it("reports both credential sets when both work", async () => {
    const j = (await tools.call("ccx_admin_check")).json() as any;
    expect(j.basic_check).toBe("ok");
    expect(j.session_check).toMatchObject({ login: "admin@example.com", is_admin: true, roles: ["admin-user:super-admin"] });
  });

  it("reports a failing basic check without failing the whole tool", async () => {
    msw.use(http.get(`${API}/admin/check`, () => new HttpResponse(null, { status: 401 })));
    const r = await tools.call("ccx_admin_check");
    expect(r.isError).toBe(false);
    const j = r.json() as any;
    expect(j.basic_check).toMatch(/failed: API error 401/);
    expect(j.session_check.login).toBe("admin@example.com");
  });

  it("only checks what is configured", async () => {
    setEnv({ session: true, basic: false });
    const j = (await tools.call("ccx_admin_check")).json() as any;
    expect(j.basic_auth).toBe("not configured");
    expect(j.basic_check).toBeUndefined();
    expect(j.session_check.login).toBe("admin@example.com");
  });

  it("errors when nothing is configured", async () => {
    setEnv({ session: false, basic: false });
    const r = await tools.call("ccx_admin_check");
    expect(r.isError).toBe(true);
  });
});

describe("ccx_admin_cmon_version", () => {
  it("returns the cmon version via the session", async () => {
    expect((await tools.call("ccx_admin_cmon_version")).json()).toEqual({ cmon_version: "2.4.0.24243" });
  });

  it("explains missing session credentials", async () => {
    setEnv({ session: false, basic: true });
    const r = await tools.call("ccx_admin_cmon_version");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/CCX_ADMIN_USERNAME/);
  });
});

describe("counters", () => {
  it("use the basic-auth counter endpoints when basic creds exist", async () => {
    expect((await tools.call("ccx_admin_count_datastores")).json()).toMatchObject({ count: 10, source: "/admin/datastores/count" });
    const users = (await tools.call("ccx_admin_count_users")).json() as any;
    expect(users.customer_count).toMatchObject({ count: 7, source: "/admin/users/count" });
    // with a session too, the list breakdown is reported alongside the counter
    expect(users.all_users).toMatchObject({ total: 3, suspended: 1, deleted: 1, internal: 0, external: 3, active_external: 1 });
  });

  it("fall back to counting the lists over the session otherwise", async () => {
    setEnv({ session: true, basic: false });
    expect((await tools.call("ccx_admin_count_datastores")).json()).toMatchObject({ count: 3 });
    const users = (await tools.call("ccx_admin_count_users")).json() as any;
    expect(users.customer_count).toBeUndefined();
    expect(users.all_users).toMatchObject({ total: 3 });
  });

  it("classify severalnines logins as internal", async () => {
    setEnv({ session: true, basic: false });
    msw.use(
      http.get(`${API}/admin/users`, () =>
        HttpResponse.json({ users: [
          { id: "i-1", login: "dev@severalnines.com", first_name: "", last_name: "", created_at: "", suspended: false, deleted: false },
          { id: "i-2", login: "ops@S9S.io", first_name: "", last_name: "", created_at: "", suspended: false, deleted: true },
          { id: "e-1", login: "cust@example.com", first_name: "", last_name: "", created_at: "", suspended: false, deleted: false },
        ] }),
      ),
    );
    const users = (await tools.call("ccx_admin_count_users")).json() as any;
    expect(users.all_users).toMatchObject({ total: 3, internal: 2, external: 1, active_external: 1 });
  });

  it("only basic creds: counter alone, no list", async () => {
    setEnv({ session: false, basic: true });
    const users = (await tools.call("ccx_admin_count_users")).json() as any;
    expect(users.customer_count.count).toBe(7);
    expect(users.all_users).toBeUndefined();
  });
});

describe("ccx_admin_list_vpcs", () => {
  it("returns the region listing with null arrays normalised", async () => {
    const j = (await tools.call("ccx_admin_list_vpcs", { region: "eu-north-1" })).json() as any;
    expect(j).toMatchObject({ region: "eu-north-1", ccx_num_vpcs: 1, ccx_vpc_ids: ["vpc-1"], aws_vpc_ids: [] });
    expect(j.caveat).toBeTruthy();
  });

  it("needs basic credentials", async () => {
    setEnv({ session: true, basic: false });
    const r = await tools.call("ccx_admin_list_vpcs", { region: "eu-north-1" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/CCX_ADMIN_BASIC_USERNAME/);
  });
});

describe("ccx_admin_billing_usage", () => {
  it("passes dates through and totals instance hours", async () => {
    let query = "";
    msw.use(
      http.get(`${API}/admin/datastores/billing/usage/json`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json(billing);
      }),
    );
    const j = (await tools.call("ccx_admin_billing_usage", { from: "2026-09-01", to: "2026-09-02" })).json() as any;
    expect(query).toBe("?from=2026-09-01&to=2026-09-02");
    expect(j.total_datastores).toBe(2);
    expect(j.summary).toMatchObject({ matched_datastores: 2, instance_hours_total: 72, backups_taken_total: 2 });
    expect(j.datastores[0]).toMatchObject({ datastore: "ds-1111-aaaa", customer_reference: "ACME-1", instance_hours_total: 72 });
    expect(j.datastores[1].deleted_at).toBe("2026-09-01T12:00:00Z");
  });

  it("filters by customer, vendor and datastore", async () => {
    const byCustomer = (await tools.call("ccx_admin_billing_usage", { from: "2026-09-01", customer_id: "u-2" })).json() as any;
    expect(byCustomer.datastores.map((d: any) => d.datastore)).toEqual(["ds-9999-zzzz"]);
    const byVendor = (await tools.call("ccx_admin_billing_usage", { from: "2026-09-01", vendor: "MariaDB" })).json() as any;
    expect(byVendor.datastores.map((d: any) => d.datastore)).toEqual(["ds-1111-aaaa"]);
    const byRef = (await tools.call("ccx_admin_billing_usage", { from: "2026-09-01", customer_reference: "acme" })).json() as any;
    expect(byRef.summary.matched_datastores).toBe(1);
  });

  it("rejects malformed dates before calling the API", async () => {
    const r = await tools.call("ccx_admin_billing_usage", { from: "01/09/2026" });
    expect(r.isError).toBe(true);
  });

  it("works with basic auth only", async () => {
    setEnv({ session: false, basic: true });
    const r = await tools.call("ccx_admin_billing_usage", { from: "2026-09-01" });
    expect(r.isError).toBe(false);
  });
});
