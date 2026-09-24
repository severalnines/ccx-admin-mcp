import { regionSchema } from "../validate.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { fail, ok } from "../format.js";
import type { VpcsAllResponse } from "../types.js";

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_list_vpcs",
    {
      title: "List VPCs in a region",
      description:
        "List VPC ids known to CCX for an AWS region, with dangling-VPC detection fields. Requires basic auth credentials. NOTE: the backend currently only fills ccx_num_vpcs/ccx_vpc_ids and may return zero even when VPCs exist; treat an empty result as 'unknown', not 'none'.",
      inputSchema: {
        region: regionSchema.describe("AWS region code, e.g. eu-north-1"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ region }) => {
      try {
        const r = (await get(`/admin/vpcs/${encodeURIComponent(region)}/all`, { auth: "basic" })) as VpcsAllResponse;
        return ok({
          region: r.region,
          ccx_num_vpcs: r.ccx_num_vpcs,
          ccx_vpc_ids: r.ccx_vpc_ids ?? [],
          aws_num_vpcs: r.aws_num_vpcs,
          aws_vpc_ids: r.aws_vpc_ids ?? [],
          aws_dangling_vpc_ids: r.aws_dangling_vpc_ids ?? [],
          ccx_dangling_vpc_ids: r.ccx_dangling_vpc_ids ?? [],
          caveat: "Backend does not query the cloud provider for this endpoint; counts may be zero regardless of actual VPCs.",
        });
      } catch (e) {
        return fail("Error listing VPCs", e);
      }
    },
  );
}
