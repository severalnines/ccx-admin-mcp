import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { fail, ok } from "../format.js";
import type { AuditResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_get_datastore_audit",
    {
      title: "Get datastore audit log",
      description:
        "Query the audit log of a datastore (jobs, resource create/delete, info lines), newest first. Time bounds are RFC3339 timestamps, e.g. 2026-09-01T00:00:00Z.",
      inputSchema: {
        datastore_id: z.string().min(1).describe("Datastore UUID"),
        from: z.string().optional().describe("Only entries at or after this RFC3339 time"),
        to: z.string().optional().describe("Only entries before this RFC3339 time"),
        limit: z.number().int().min(1).max(1000).optional().describe("Max lines (default 20)"),
        type: z.string().optional().describe("Client-side filter on entry type, e.g. job, info, delete_resource, create_resource"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ datastore_id, from, to, limit, type }) => {
      try {
        const r = (await get(`/admin/datastores/${encodeURIComponent(datastore_id)}/audit`, {
          params: { from, to, limit: limit !== undefined ? String(limit) : undefined },
        })) as AuditResponse;
        const lines = (r.lines ?? []).filter((l) => !type || l.type === type);
        return ok({
          datastore_id,
          returned: lines.length,
          lines: lines.map((l) => ({ time: l.time, type: l.type, user: l.user, text: l.text, data: l.data })),
        });
      } catch (e) {
        return fail(`Error reading audit log for datastore ${datastore_id}`, e);
      }
    },
  );
}
