import { z } from "zod";
import { idSchema } from "../validate.js";
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
        datastore_id: idSchema.describe("Datastore UUID"),
        from: z.string().optional().describe("Only entries at or after this RFC3339 time"),
        to: z.string().optional().describe("Only entries before this RFC3339 time"),
        limit: z.number().int().min(1).max(1000).optional().describe("Max lines to return (default 20)"),
        type: z.string().optional().describe("Only entries of this type, e.g. job, info, delete_resource, create_resource. Filtering happens after fetching a wider window (up to 1000 lines); 'fetched' and 'window_exhausted' tell you whether older matches may exist."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ datastore_id, from, to, limit, type }) => {
      try {
        const want = limit ?? 20;
        // The backend truncates before we can filter, so fetch a wider window when a type filter is set.
        const serverLimit = type ? Math.min(1000, Math.max(want * 10, 200)) : want;
        const r = (await get(`/admin/datastores/${encodeURIComponent(datastore_id)}/audit`, {
          params: { from, to, limit: String(serverLimit) },
        })) as AuditResponse;
        const fetched = r.lines ?? [];
        const matched = fetched.filter((l) => !type || l.type === type);
        const lines = matched.slice(0, want);
        return ok({
          datastore_id,
          fetched: fetched.length,
          matched: matched.length,
          returned: lines.length,
          window_exhausted: fetched.length >= serverLimit,
          lines: lines.map((l) => ({ time: l.time, type: l.type, user: l.user, text: l.text, data: l.data })),
        });
      } catch (e) {
        return fail(`Error reading audit log for datastore ${datastore_id}`, e);
      }
    },
  );
}
