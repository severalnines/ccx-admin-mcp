import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { hasBasicCredentials } from "../auth.js";
import { fail, ok } from "../format.js";
import type { CountResponse, ListDatastoresResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_count_datastores",
    {
      title: "Count datastores",
      description:
        "Total number of datastores (database clusters) across all CCX users. Uses the basic-auth counter endpoint when basic credentials are configured, otherwise counts the full datastore list via the admin session.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        if (hasBasicCredentials()) {
          const r = (await get("/admin/datastores/count", { auth: "basic" })) as CountResponse;
          return ok({ count: r.count, source: "/admin/datastores/count" });
        }
        const r = (await get("/admin/datastores")) as ListDatastoresResponse;
        return ok({ count: (r.clusters ?? []).length, source: "/admin/datastores (counted client-side)" });
      } catch (e) {
        return fail("Error counting datastores", e);
      }
    },
  );
}
