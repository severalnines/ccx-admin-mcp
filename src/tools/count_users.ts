import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { hasBasicCredentials, hasSessionCredentials } from "../auth.js";
import { fail, ok } from "../format.js";
import type { CountResponse, ListUsersResponse } from "../types.js";

const INTERNAL_SUFFIXES = ["@severalnines.com", "@s9s.io"];

export function isInternalLogin(login: string): boolean {
  const l = login.toLowerCase();
  return INTERNAL_SUFFIXES.some((s) => l.endsWith(s));
}

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_count_users",
    {
      title: "Count users",
      description:
        "Count CCX users. The basic-auth counter endpoint (/admin/users/count) counts customer accounts: it excludes @severalnines.com / @s9s.io logins in production and still includes deleted users. When an admin session is configured the full user list is also counted client-side, broken down by internal/external, suspended and deleted, so the two numbers can be reconciled.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const result: Record<string, unknown> = {};
      let errors = 0;
      if (hasBasicCredentials()) {
        try {
          const r = (await get("/admin/users/count", { auth: "basic" })) as CountResponse;
          result.customer_count = {
            count: r.count,
            source: "/admin/users/count",
            note: "excludes @severalnines.com/@s9s.io logins in production; includes deleted users",
          };
        } catch (e) {
          errors++;
          result.customer_count = `failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      if (hasSessionCredentials()) {
        try {
          const r = (await get("/admin/users")) as ListUsersResponse;
          const users = r.users ?? [];
          result.all_users = {
            total: users.length,
            internal: users.filter((u) => isInternalLogin(u.login)).length,
            external: users.filter((u) => !isInternalLogin(u.login)).length,
            suspended: users.filter((u) => u.suspended).length,
            deleted: users.filter((u) => u.deleted).length,
            active_external: users.filter((u) => !isInternalLogin(u.login) && !u.deleted && !u.suspended).length,
            source: "/admin/users (counted client-side)",
          };
        } catch (e) {
          errors++;
          result.all_users = `failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      if (Object.keys(result).length === 0) return fail("Error counting users", new Error("no credentials configured"));
      if (errors > 0 && errors === Object.keys(result).length) return fail("Error counting users", new Error(JSON.stringify(result)));
      return ok(result);
    },
  );
}
