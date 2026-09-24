import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { hasBasicCredentials, hasSessionCredentials } from "../auth.js";
import { errorMessage, fail, ok } from "../format.js";
import type { AuthCheckResponse, SuccessResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_check",
    {
      title: "Check admin API access",
      description:
        "Verify connectivity and credentials against the CCX admin API. Reports the admin REST health check (basic auth) and the admin session identity (admin user login), whichever credentials are configured.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const result: Record<string, unknown> = {
        base_url: process.env.CCX_BASE_URL,
        session_auth: hasSessionCredentials() ? "configured" : "not configured",
        basic_auth: hasBasicCredentials() ? "configured" : "not configured",
      };
      if (hasBasicCredentials()) {
        try {
          const r = (await get("/admin/check", { auth: "basic" })) as SuccessResponse;
          result.basic_check = r.success ? "ok" : r;
        } catch (e) {
          result.basic_check = `failed: ${errorMessage(e)}`;
        }
      }
      if (hasSessionCredentials()) {
        try {
          const r = (await get("/auth/check", { auth: "session" })) as AuthCheckResponse;
          result.session_check = {
            login: r.login,
            user_id: r.id,
            is_admin: r.isAdmin ?? null,
            roles: (r.scopes ?? []).map((s) => `${s.type}:${s.role}`),
          };
        } catch (e) {
          result.session_check = `failed: ${errorMessage(e)}`;
        }
      }
      if (!hasBasicCredentials() && !hasSessionCredentials()) {
        return fail("Admin check", new Error("no credentials configured"));
      }
      return ok(result);
    },
  );
}
