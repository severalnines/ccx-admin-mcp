import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { del } from "../client.js";
import { fail, ok } from "../format.js";
import { isProtected, protectedError } from "../protect.js";
import type { DeleteResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_delete_datastore",
    {
      title: "Force-delete datastore",
      description:
        "FORCE-DELETE any user's datastore as admin. This destroys the cluster and its data and cannot be undone. Requires confirm=true and is blocked while protection mode (CCX_PROTECT) is on.",
      inputSchema: {
        datastore_id: z.string().min(1).describe("Datastore UUID to delete"),
        confirm: z.boolean().describe("Must be explicitly true to proceed"),
      },
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ datastore_id, confirm }) => {
      if (isProtected()) return protectedError("Delete datastore");
      if (!confirm) {
        return fail("Deletion aborted", new Error("'confirm' must be explicitly set to true; this destroys the cluster and its data"));
      }
      try {
        const r = (await del(`/admin/datastores/${encodeURIComponent(datastore_id)}`)) as DeleteResponse;
        return ok({
          datastore_id,
          deleted: r.deleted === true,
          message: "Force deletion requested. The cluster and its cloud resources will be removed by a job; check the audit log for progress.",
        });
      } catch (e) {
        return fail(`Error deleting datastore ${datastore_id}`, e);
      }
    },
  );
}
