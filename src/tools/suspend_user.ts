import { z } from "zod";
import { idSchema } from "../validate.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { post } from "../client.js";
import { fail, ok } from "../format.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_suspend_user",
    {
      title: "Suspend user",
      description:
        "Suspend a CCX user so they can no longer log in or use their datastores. Reversible with ccx_admin_unsuspend_user. Requires confirm=true. Only available when protection mode is off (CCX_PROTECT=false).",
      inputSchema: {
        user_id: idSchema.describe("User UUID (see ccx_admin_list_users)"),
        reason: z.string().min(1).describe("Reason recorded with the suspension"),
        confirm: z.boolean().describe("Must be explicitly true to proceed"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ user_id, reason, confirm }) => {
      if (!confirm) {
        return fail("Suspension aborted", new Error("'confirm' must be explicitly set to true; the user loses access immediately"));
      }
      try {
        await post(`/admin/users/${encodeURIComponent(user_id)}`, { body: { suspend: { reason } } });
        return ok({ user_id, suspended: true, reason });
      } catch (e) {
        return fail(`Error suspending user ${user_id}`, e);
      }
    },
  );
}
