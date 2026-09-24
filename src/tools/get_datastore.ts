import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { fail, ok } from "../format.js";
import type { GetDatastoreResponse } from "../types.js";
import { summarizeNode } from "./list_nodes.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_get_datastore",
    {
      title: "Get datastore",
      description:
        "Get one datastore by UUID regardless of owner: status, owner login, cmon internal cluster id, the latest job (including its raw data) and the database nodes.",
      inputSchema: {
        datastore_id: z.string().min(1).describe("Datastore UUID"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ datastore_id }) => {
      try {
        const d = (await get(`/admin/datastores/${encodeURIComponent(datastore_id)}`)) as GetDatastoreResponse;
        return ok({
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
          current_job: d.current_job?.job_id ? d.current_job : null,
          nodes: (d.nodes ?? []).map(summarizeNode),
        });
      } catch (e) {
        return fail(`Error getting datastore ${datastore_id}`, e);
      }
    },
  );
}
