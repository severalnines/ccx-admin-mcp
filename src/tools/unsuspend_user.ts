import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { post } from "../client.js";
import { fail, ok } from "../format.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_unsuspend_user",
    {
      title: "Unsuspend user",
      description: "Lift a suspension so the CCX user can log in and use their datastores again.",
      inputSchema: {
        user_id: z.string().min(1).describe("User UUID (see ccx_admin_list_users)"),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ user_id }) => {
      try {
        await post(`/admin/users/${encodeURIComponent(user_id)}`, { body: { unsuspend: {} } });
        return ok({ user_id, suspended: false });
      } catch (e) {
        return fail(`Error unsuspending user ${user_id}`, e);
      }
    },
  );
}
