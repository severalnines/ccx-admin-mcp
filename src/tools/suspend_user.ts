import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { post } from "../client.js";
import { fail, ok } from "../format.js";
import { isProtected, protectedError } from "../protect.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_suspend_user",
    {
      title: "Suspend user",
      description:
        "Suspend a CCX user so they can no longer log in or use their datastores. Reversible with ccx_admin_unsuspend_user. Blocked while protection mode (CCX_PROTECT) is on.",
      inputSchema: {
        user_id: z.string().min(1).describe("User UUID (see ccx_admin_list_users)"),
        reason: z.string().min(1).describe("Reason recorded with the suspension"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ user_id, reason }) => {
      if (isProtected()) return protectedError("Suspend user");
      try {
        await post(`/admin/users/${encodeURIComponent(user_id)}`, { body: { suspend: { reason } } });
        return ok({ user_id, suspended: true, reason });
      } catch (e) {
        return fail(`Error suspending user ${user_id}`, e);
      }
    },
  );
}
