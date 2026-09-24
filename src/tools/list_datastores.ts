import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { contains, equalsCI, fail, ok, page } from "../format.js";
import type { Datastore, ListDatastoresResponse } from "../types.js";

export function summarizeDatastore(d: Datastore) {
  const job = d.current_job;
  return {
    id: d.id,
    name: d.name,
    status: d.status,
    status_text: d.status_text,
    type: d.type,
    cloud_provider: d.cloud_provider,
    size: d.size,
    user_login: d.user_login,
    internal_id: d.internal_id,
    created_at: d.created_at,
    current_job: job?.job_id
      ? {
          job_id: job.job_id,
          type: job.type,
          status: job.status,
          user: job.user,
          created_at: job.created_at,
          finished_at: job.finished_at,
        }
      : null,
  };
}

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_list_datastores",
    {
      title: "List all datastores",
      description:
        "List datastores (database clusters) across ALL CCX users, with owner, status and the latest job. The API returns everything in one call; filters are applied client-side. Status values include STARTED, DEGRADED, FAILURE, STOPPED, UNKNOWN, and CCX lifecycle states such as creating_cluster, deploy_failed, deleting, unreachable.",
      inputSchema: {
        status: z.string().optional().describe("Exact status to match (case-insensitive), e.g. DEGRADED"),
        cloud_provider: z.string().optional().describe("Exact cloud provider, e.g. aws, elastx"),
        type: z.string().optional().describe("Exact cluster type, e.g. replication, galera, postgres_streaming, redis"),
        user_login: z.string().optional().describe("Substring of the owner's login/email"),
        name: z.string().optional().describe("Substring of the datastore name"),
        job_status: z.string().optional().describe("Exact status of the latest job, e.g. JOB_STATUS_FAILED, JOB_STATUS_RUNNING"),
        limit: z.number().int().min(1).max(500).optional().describe("Max results (default 50)"),
        offset: z.number().int().min(0).optional().describe("Offset into the filtered list"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ status, cloud_provider, type, user_login, name, job_status, limit, offset }) => {
      try {
        const r = (await get("/admin/datastores")) as ListDatastoresResponse;
        const all = r.clusters ?? [];
        const filtered = all.filter(
          (d) =>
            equalsCI(d.status, status) &&
            equalsCI(d.cloud_provider, cloud_provider) &&
            equalsCI(d.type, type) &&
            contains(d.user_login, user_login) &&
            contains(d.name, name) &&
            equalsCI(d.current_job?.status, job_status),
        );
        const { items, pagination } = page(filtered, limit, offset);
        const byStatus: Record<string, number> = {};
        for (const d of all) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
        return ok({
          total: all.length,
          by_status: byStatus,
          pagination,
          datastores: items.map(summarizeDatastore),
        });
      } catch (e) {
        return fail("Error listing datastores", e);
      }
    },
  );
}
