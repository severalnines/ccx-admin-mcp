import { z } from "zod";
import { idSchema } from "../validate.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { del } from "../client.js";
import { fail, ok } from "../format.js";
import type { DeleteResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_delete_user",
    {
      title: "Delete user",
      description:
        "Delete a CCX user account. This cannot be undone. Requires confirm=true. Only available when protection mode is off (CCX_PROTECT=false). Consider ccx_admin_suspend_user instead.",
      inputSchema: {
        user_id: idSchema.describe("User UUID to delete"),
        confirm: z.boolean().describe("Must be explicitly true to proceed"),
      },
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ user_id, confirm }) => {
      if (!confirm) {
        return fail("Deletion aborted", new Error("'confirm' must be explicitly set to true; this cannot be undone"));
      }
      try {
        const r = (await del(`/admin/users/${encodeURIComponent(user_id)}`)) as DeleteResponse;
        return ok({ user_id, deleted: r.deleted === true });
      } catch (e) {
        return fail(`Error deleting user ${user_id}`, e);
      }
    },
  );
}
