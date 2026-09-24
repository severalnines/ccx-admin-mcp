import { idSchema } from "../validate.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { fail, ok } from "../format.js";
import type { ListNodesResponse, Node } from "../types.js";

export function summarizeNode(n: Node) {
  return {
    hostname: n.hostname,
    ip: n.ip,
    role: n.role,
    node_type: n.node_type,
    host_status: n.host_status,
    version: n.version,
    unique_id: n.unique_id,
    last_seen: n.last_seen,
    service_started_at: n.service_started_at,
    host: n.host
      ? {
          id: n.host.id,
          instance_id: n.host.instance_id,
          instance_type: n.host.instance_type,
          az: n.host.az,
          cloud_provider: n.host.cloud_provider,
        }
      : null,
  };
}

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_list_nodes",
    {
      title: "List datastore nodes",
      description:
        "List the database and load-balancer nodes of a datastore: hostname, IP, role, cmon host status (e.g. CmonHostOnline), DB version, cloud instance id/type and availability zone.",
      inputSchema: {
        datastore_id: idSchema.describe("Datastore UUID"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ datastore_id }) => {
      try {
        const r = (await get(`/admin/datastores/${encodeURIComponent(datastore_id)}/nodes`)) as ListNodesResponse;
        return ok({
          datastore_id,
          db_nodes: (r.nodes?.db_nodes ?? []).map(summarizeNode),
          lb_nodes: (r.nodes?.lb_nodes ?? []).map(summarizeNode),
        });
      } catch (e) {
        return fail(`Error listing nodes for datastore ${datastore_id}`, e);
      }
    },
  );
}
