import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { get } from "../client.js";
import { contains, fail, ok, page } from "../format.js";
import type { UsageDatastore, UsageDatastoresResponse } from "../types.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function summarizeUsage(d: UsageDatastore) {
  const instanceHours = d.instances_types_usage.reduce((s, i) => s + i.hours, 0);
  return {
    datastore: d.datastore,
    customer_id: d.customer_id,
    customer_reference: d.customer_reference ?? null,
    vendor: d.vendor,
    type: d.type,
    nodes_count: d.nodes_count,
    created_at: d.created_at,
    deleted_at: d.deleted_at,
    instance_hours_total: Number(instanceHours.toFixed(2)),
    instances_types_usage: d.instances_types_usage,
    volumes_types_usage: d.volumes_types_usage,
    network_egress_usage_gib: d.network_egress_usage_gib,
    backups: d.backups,
    custom_values: d.custom_values ?? null,
  };
}

export function register(server: McpServer) {
  server.registerTool(
    "ccx_admin_billing_usage",
    {
      title: "Billing usage report",
      description:
        "Per-datastore resource usage for a date range across all customers: instance hours by instance type, volume GiB-hours and IOPS, network egress and backup counts/sizes. Dates are YYYY-MM-DD and inclusive; 'to' defaults to today. Includes datastores deleted during the period.",
      inputSchema: {
        from: z.string().regex(DATE, "YYYY-MM-DD").describe("Start date (inclusive), YYYY-MM-DD"),
        to: z.string().regex(DATE, "YYYY-MM-DD").optional().describe("End date (inclusive), YYYY-MM-DD; default today"),
        datastore_id: z.string().optional().describe("Only this datastore UUID"),
        customer_id: z.string().optional().describe("Only this customer (user) UUID"),
        customer_reference: z.string().optional().describe("Substring of the customer's external reference"),
        vendor: z.string().optional().describe("Exact vendor, e.g. postgres, mariadb, percona, redis"),
        limit: z.number().int().min(1).max(1000).optional().describe("Max datastores (default 50)"),
        offset: z.number().int().min(0).optional().describe("Offset into the filtered list"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ from, to, datastore_id, customer_id, customer_reference, vendor, limit, offset }) => {
      try {
        const r = (await get("/admin/datastores/billing/usage/json", {
          auth: "any",
          params: { from, to },
        })) as UsageDatastoresResponse;
        const all = r.datastores ?? [];
        const filtered = all.filter(
          (d) =>
            (!datastore_id || d.datastore === datastore_id) &&
            (!customer_id || d.customer_id === customer_id) &&
            contains(d.customer_reference, customer_reference) &&
            (!vendor || d.vendor.toLowerCase() === vendor.toLowerCase()),
        );
        const { items, pagination } = page(filtered, limit, offset);
        const totalInstanceHours = filtered.reduce(
          (s, d) => s + d.instances_types_usage.reduce((t, i) => t + i.hours, 0),
          0,
        );
        return ok({
          from: r.from,
          to: r.to,
          total_datastores: all.length,
          summary: {
            matched_datastores: filtered.length,
            instance_hours_total: Number(totalInstanceHours.toFixed(2)),
            network_egress_gib_total: Number(filtered.reduce((s, d) => s + d.network_egress_usage_gib, 0).toFixed(3)),
            backups_taken_total: filtered.reduce((s, d) => s + d.backups.taken, 0),
          },
          pagination,
          datastores: items.map(summarizeUsage),
        });
      } catch (e) {
        return fail("Error fetching billing usage", e);
      }
    },
  );
}
