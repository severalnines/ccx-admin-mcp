import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { fail, ok } from "../format.js";
import type { CmonVersionResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_cmon_version",
    {
      title: "Get cmon version",
      description: "Get the version of the ClusterControl controller (cmon) backing this CCX deployment.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const r = (await get("/admin/cmon/version")) as CmonVersionResponse;
        return ok({ cmon_version: r.cmon_version });
      } catch (e) {
        return fail("Error getting cmon version", e);
      }
    },
  );
}
