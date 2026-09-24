import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { contains, fail, ok, page } from "../format.js";
import type { ListUsersResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_list_users",
    {
      title: "List users",
      description:
        "List all CCX users with id, login, name, creation time and suspended/deleted flags. The API returns everything; filters are applied client-side.",
      inputSchema: {
        login: z.string().optional().describe("Substring of the login/email"),
        name: z.string().optional().describe("Substring of first or last name"),
        suspended: z.boolean().optional().describe("Only suspended (true) or only active (false)"),
        deleted: z.boolean().optional().describe("Only deleted (true) or only existing (false)"),
        limit: z.number().int().min(1).max(1000).optional().describe("Max results (default 50)"),
        offset: z.number().int().min(0).optional().describe("Offset into the filtered list"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ login, name, suspended, deleted, limit, offset }) => {
      try {
        const r = (await get("/admin/users")) as ListUsersResponse;
        const all = r.users ?? [];
        const filtered = all.filter(
          (u) =>
            contains(u.login, login) &&
            (contains(u.first_name, name) || contains(u.last_name, name)) &&
            (suspended === undefined || u.suspended === suspended) &&
            (deleted === undefined || u.deleted === deleted),
        );
        const { items, pagination } = page(filtered, limit, offset);
        return ok({
          total: all.length,
          suspended: all.filter((u) => u.suspended).length,
          deleted: all.filter((u) => u.deleted).length,
          pagination,
          users: items,
        });
      } catch (e) {
        return fail("Error listing users", e);
      }
    },
  );
}
