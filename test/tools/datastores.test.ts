import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { msw, API, loginHandler, requireSession, setEnv, connectTools, type ToolCaller } from "../helpers.js";
import { clearSession } from "../../src/auth.js";
import datastores from "../fixtures/datastores.json";
import datastore from "../fixtures/datastore.json";
import nodes from "../fixtures/nodes.json";
import audit from "../fixtures/audit.json";

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
    http.get(`${API}/admin/datastores`, ({ request }) => requireSession(request) ?? HttpResponse.json(datastores)),
    http.get(`${API}/admin/datastores/:id`, ({ request, params }) => {
      const denied = requireSession(request);
      if (denied) return denied;
      if (params.id !== "ds-1111-aaaa") {
        return HttpResponse.json({ err: "rpc error: code = NotFound desc = datastore not found" }, { status: 500 });
      }
      return HttpResponse.json(datastore);
    }),
    http.get(`${API}/admin/datastores/:id/nodes`, ({ request }) => requireSession(request) ?? HttpResponse.json(nodes)),
    http.get(`${API}/admin/datastores/:id/audit`, ({ request }) => requireSession(request) ?? HttpResponse.json(audit)),
  );
});
afterEach(() => msw.resetHandlers());

describe("tool registry", () => {
  it("exposes every admin tool", async () => {
    expect(await tools.listTools()).toEqual([
      "ccx_admin_billing_usage",
      "ccx_admin_check",
      "ccx_admin_cmon_version",
      "ccx_admin_count_datastores",
      "ccx_admin_count_users",
      "ccx_admin_delete_datastore",
      "ccx_admin_delete_user",
      "ccx_admin_get_datastore",
      "ccx_admin_get_datastore_audit",
      "ccx_admin_list_datastores",
      "ccx_admin_list_nodes",
      "ccx_admin_list_users",
      "ccx_admin_list_vpcs",
      "ccx_admin_suspend_user",
      "ccx_admin_unsuspend_user",
    ]);
  });
});

describe("ccx_admin_list_datastores", () => {
  it("summarises all datastores with owner, status histogram and latest job", async () => {
    const r = await tools.call("ccx_admin_list_datastores");
    expect(r.isError).toBe(false);
    const j = r.json() as any;
    expect(j.total).toBe(3);
    expect(j.by_status).toEqual({ STARTED: 2, DEGRADED: 1 });
    expect(j.pagination).toMatchObject({ offset: 0, limit: 50, returned: 3, matched: 3, has_more: false });
    expect(j.datastores[0]).toMatchObject({
      id: "ds-1111-aaaa",
      name: "fancy-breeze",
      user_login: "alice@example.com",
      internal_id: 22877,
      current_job: { job_id: "2d01aadc-4049-4726-920b-7c4728de5b4c", type: "JOB_TYPE_REMOVE_NODE", status: "JOB_STATUS_FINISHED" },
    });
    // job raw data is not included in the list summary
    expect(j.datastores[0].current_job.data).toBeUndefined();
    // an empty current_job object becomes null
    expect(j.datastores[2].current_job).toBeNull();
  });

  it("filters by status (case-insensitive) and by owner substring", async () => {
    const byStatus = (await tools.call("ccx_admin_list_datastores", { status: "degraded" })).json() as any;
    expect(byStatus.datastores.map((d: any) => d.id)).toEqual(["ds-2222-bbbb"]);
    expect(byStatus.total).toBe(3);

    const byOwner = (await tools.call("ccx_admin_list_datastores", { user_login: "ALICE" })).json() as any;
    expect(byOwner.datastores.map((d: any) => d.id)).toEqual(["ds-1111-aaaa", "ds-3333-cccc"]);
  });

  it("filters by latest job status, type and cloud provider", async () => {
    const failed = (await tools.call("ccx_admin_list_datastores", { job_status: "JOB_STATUS_FAILED" })).json() as any;
    expect(failed.datastores.map((d: any) => d.id)).toEqual(["ds-2222-bbbb"]);
    const pg = (await tools.call("ccx_admin_list_datastores", { type: "postgres_streaming", cloud_provider: "aws" })).json() as any;
    expect(pg.pagination.matched).toBe(1);
    const none = (await tools.call("ccx_admin_list_datastores", { type: "postgres_streaming", cloud_provider: "elastx" })).json() as any;
    expect(none.pagination.matched).toBe(0);
  });

  it("paginates the filtered list", async () => {
    const p = (await tools.call("ccx_admin_list_datastores", { limit: 1, offset: 1 })).json() as any;
    expect(p.datastores.map((d: any) => d.id)).toEqual(["ds-2222-bbbb"]);
    expect(p.pagination).toMatchObject({ returned: 1, matched: 3, has_more: true });
  });

  it("rejects out-of-range arguments before calling the API", async () => {
    const r = await tools.call("ccx_admin_list_datastores", { limit: 0 });
    expect(r.isError).toBe(true);
  });

  it("reports API failures as tool errors", async () => {
    msw.use(http.get(`${API}/admin/datastores`, () => HttpResponse.json({ err: "boom" }, { status: 500 })));
    const r = await tools.call("ccx_admin_list_datastores");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Error listing datastores: API error 500/);
  });
});

describe("ccx_admin_get_datastore", () => {
  it("returns the datastore with full job and summarised nodes", async () => {
    const j = (await tools.call("ccx_admin_get_datastore", { datastore_id: "ds-1111-aaaa" })).json() as any;
    expect(j).toMatchObject({ id: "ds-1111-aaaa", user_login: "alice@example.com", status: "STARTED" });
    expect(j.current_job.data).toEqual({ ClusterUUID: "ds-1111-aaaa" });
    expect(j.nodes).toHaveLength(datastore.nodes.length);
    expect(j.nodes[0]).toMatchObject({
      hostname: "db-1.ds-1111-aaaa.example.net",
      ip: "10.0.0.1",
      role: "master",
      host_status: "CmonHostOnline",
      host: { instance_type: "v1-small-1", az: "sto1", cloud_provider: "elastx" },
    });
  });

  it("rejects path-like ids before calling the API", async () => {
    let called = false;
    msw.use(http.get(`${API}/admin/*`, () => { called = true; return HttpResponse.json({}); }));
    for (const datastore_id of ["..", "../users", "a/b", ""]) {
      const r = await tools.call("ccx_admin_get_datastore", { datastore_id });
      expect(r.isError, datastore_id).toBe(true);
    }
    expect(called).toBe(false);
  });

  it("surfaces not-found as an error naming the id", async () => {
    const r = await tools.call("ccx_admin_get_datastore", { datastore_id: "missing" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/missing/);
    expect(r.text).toMatch(/datastore not found/);
  });
});

describe("ccx_admin_list_nodes", () => {
  it("splits db and lb nodes", async () => {
    const j = (await tools.call("ccx_admin_list_nodes", { datastore_id: "ds-1111-aaaa" })).json() as any;
    expect(j.db_nodes).toHaveLength(nodes.nodes.db_nodes.length);
    expect(j.db_nodes.map((n: any) => n.role)).toEqual(nodes.nodes.db_nodes.map((n) => n.role));
    expect(j.lb_nodes).toEqual([]);
    expect(j.db_nodes[0].version).toMatch(/MariaDB/);
  });

  it("tolerates null node arrays", async () => {
    msw.use(http.get(`${API}/admin/datastores/:id/nodes`, () => HttpResponse.json({ nodes: { db_nodes: null, lb_nodes: null } })));
    const j = (await tools.call("ccx_admin_list_nodes", { datastore_id: "ds-1111-aaaa" })).json() as any;
    expect(j.db_nodes).toEqual([]);
  });
});

describe("ccx_admin_get_datastore_audit", () => {
  it("passes from/to/limit as query params and returns lines", async () => {
    let query = "";
    msw.use(
      http.get(`${API}/admin/datastores/:id/audit`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json(audit);
      }),
    );
    const j = (await tools.call("ccx_admin_get_datastore_audit", {
      datastore_id: "ds-1111-aaaa",
      from: "2026-09-01T00:00:00Z",
      limit: 3,
    })).json() as any;
    expect(query).toBe("?from=2026-09-01T00%3A00%3A00Z&limit=3");
    expect(j).toMatchObject({ fetched: 3, matched: 3, returned: 3, window_exhausted: true });
    expect(j.lines[0]).toMatchObject({ type: "job", text: "Job finished: remove_node" });
  });

  it("widens the server window when filtering by type and reports it", async () => {
    let query = "";
    msw.use(
      http.get(`${API}/admin/datastores/:id/audit`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json(audit);
      }),
    );
    const j = (await tools.call("ccx_admin_get_datastore_audit", { datastore_id: "ds-1111-aaaa", type: "info", limit: 5 })).json() as any;
    expect(query).toBe("?limit=200");
    expect(j.lines.map((l: any) => l.type)).toEqual(["info"]);
    expect(j).toMatchObject({ fetched: 3, matched: 1, returned: 1, window_exhausted: false });
  });
});

describe("ccx_admin_delete_datastore", () => {
  it("is blocked by protection mode without touching the API", async () => {
    let called = false;
    msw.use(http.delete(`${API}/admin/datastores/:id`, () => { called = true; return HttpResponse.json({ deleted: true }); }));
    const r = await tools.call("ccx_admin_delete_datastore", { datastore_id: "ds-1111-aaaa", confirm: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/BLOCKED/);
    expect(called).toBe(false);
  });

  it("requires confirm=true even when unprotected", async () => {
    setEnv({ session: true, protect: "false" });
    let called = false;
    msw.use(http.delete(`${API}/admin/datastores/:id`, () => { called = true; return HttpResponse.json({ deleted: true }); }));
    const r = await tools.call("ccx_admin_delete_datastore", { datastore_id: "ds-1111-aaaa", confirm: false });
    expect(r.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("issues DELETE with the session when unprotected and confirmed", async () => {
    setEnv({ session: true, protect: "false" });
    let cookie: string | null = null;
    msw.use(
      http.delete(`${API}/admin/datastores/ds-1111-aaaa`, ({ request }) => {
        cookie = request.headers.get("cookie");
        return HttpResponse.json({ deleted: true });
      }),
    );
    const r = await tools.call("ccx_admin_delete_datastore", { datastore_id: "ds-1111-aaaa", confirm: true });
    expect(r.isError).toBe(false);
    expect(cookie).toBe("ccx-session=sess-123");
    expect(r.json()).toMatchObject({ datastore_id: "ds-1111-aaaa", deleted: true });
  });
});
