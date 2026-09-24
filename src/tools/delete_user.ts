import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { del } from "../client.js";
import { fail, ok } from "../format.js";
import { isProtected, protectedError } from "../protect.js";
import type { DeleteResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_delete_user",
    {
      title: "Delete user",
      description:
        "Delete a CCX user account. This cannot be undone. Requires confirm=true and is blocked while protection mode (CCX_PROTECT) is on. Consider ccx_admin_suspend_user instead.",
      inputSchema: {
        user_id: z.string().min(1).describe("User UUID to delete"),
        confirm: z.boolean().describe("Must be explicitly true to proceed"),
      },
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ user_id, confirm }) => {
      if (isProtected()) return protectedError("Delete user");
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
