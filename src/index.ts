#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LoginError, getBaseUrl, hasBasicCredentials, hasSessionCredentials, loginSession } from "./auth.js";
import { loadDotenv } from "./env.js";
import { errorMessage } from "./format.js";
import { isProtected } from "./protect.js";

import { register as registerCheck } from "./tools/check.js";
import { register as registerCmonVersion } from "./tools/cmon_version.js";
import { register as registerCountDatastores } from "./tools/count_datastores.js";
import { register as registerCountUsers } from "./tools/count_users.js";
import { register as registerListVpcs } from "./tools/list_vpcs.js";
import { register as registerListDatastores } from "./tools/list_datastores.js";
import { register as registerGetDatastore } from "./tools/get_datastore.js";
import { register as registerListNodes } from "./tools/list_nodes.js";
import { register as registerGetDatastoreAudit } from "./tools/get_datastore_audit.js";
import { register as registerDeleteDatastore } from "./tools/delete_datastore.js";
import { register as registerListUsers } from "./tools/list_users.js";
import { register as registerSuspendUser } from "./tools/suspend_user.js";
import { register as registerUnsuspendUser } from "./tools/unsuspend_user.js";
import { register as registerDeleteUser } from "./tools/delete_user.js";
import { register as registerBillingUsage } from "./tools/billing_usage.js";

const USAGE = `Usage: ccx-admin-mcp [options]

Options:
  --endpoint <url>            CCX base URL (e.g. https://ccx.example.com)
  --username <email>          Admin user login  (k8s secret admin-users)
  --password <password>       Admin user password
  --basic-username <name>     HTTP basic auth user (k8s secret admin-basic-auth, optional)
  --basic-password <pass>     HTTP basic auth password
  --protect <true|false>      Block destructive tools (default: true)
  --dotenv <path>             .env file to load (default: <package>/.env; the working
                              directory is never searched). Not --env-file: Node
                              itself consumes that flag.
  -h, --help                  Show this help and exit

Environment variables (used when a flag is not given; a .env file fills in
anything still missing):
  CCX_BASE_URL, CCX_ADMIN_USERNAME, CCX_ADMIN_PASSWORD,
  CCX_ADMIN_BASIC_USERNAME, CCX_ADMIN_BASIC_PASSWORD, CCX_PROTECT, CCX_ENV_FILE

Authentication:
  Admin user login covers datastores, users, audit, billing and cmon version.
  Basic auth is only accepted by the health check, the counters and the VPC
  listing; it is optional (the counters fall back to counting the lists).
`;

const FLAGS: Record<string, string> = {
  endpoint: "CCX_BASE_URL",
  username: "CCX_ADMIN_USERNAME",
  password: "CCX_ADMIN_PASSWORD",
  "basic-username": "CCX_ADMIN_BASIC_USERNAME",
  "basic-password": "CCX_ADMIN_BASIC_PASSWORD",
  protect: "CCX_PROTECT",
  dotenv: "CCX_ENV_FILE",
};

function die(message: string, code = 2): never {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exit(code);
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (!arg.startsWith("--")) die(`Unknown argument: ${arg}`);

    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const envName = FLAGS[name];
    if (!envName) die(`Unknown flag: --${name}`);

    let value: string;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) die(`Missing value for --${name}`);
      value = next;
      i++;
    }
    out[envName] = value;
  }
  return out;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  for (const [key, value] of Object.entries(flags)) process.env[key] = value;

  const envPath = loadDotenv(process.env.CCX_ENV_FILE);
  if (envPath) process.stderr.write(`CCX admin MCP: loaded ${envPath}\n`);

  if (!process.env.CCX_BASE_URL) {
    die("Error: CCX_BASE_URL is not set (use --endpoint, the environment or a .env file).", 1);
  }
  try {
    getBaseUrl();
  } catch (e) {
    die(`Error: ${errorMessage(e)}`, 1);
  }
  if (!hasSessionCredentials() && !hasBasicCredentials()) {
    die(
      "Error: no admin credentials. Set CCX_ADMIN_USERNAME/CCX_ADMIN_PASSWORD (recommended) " +
        "and/or CCX_ADMIN_BASIC_USERNAME/CCX_ADMIN_BASIC_PASSWORD.",
      1,
    );
  }

  if (hasSessionCredentials()) {
    // Probe: a rejected password is a configuration error and fatal (re-sending
    // it on every call could lock the account); anything else is transient and
    // tools log in lazily later.
    try {
      const who = await loginSession();
      process.stderr.write(`CCX admin MCP: logged in as ${who.login}\n`);
    } catch (e) {
      if (e instanceof LoginError && (e.status === 401 || e.status === 403)) {
        die(`Error: ${e.message}`, 1);
      }
      process.stderr.write(`CCX admin MCP: WARNING admin login failed, will retry on first use: ${errorMessage(e)}\n`);
    }
  } else {
    process.stderr.write(
      "CCX admin MCP: only basic auth configured; datastore/user/audit/billing tools will be unavailable.\n",
    );
  }
  process.stderr.write(`CCX admin MCP: protection mode ${isProtected() ? "ON" : "OFF"}\n`);

  const server = new McpServer({ name: "ccx-admin", version: "0.1.0" });
  registerAllTools(server);

  await server.connect(new StdioServerTransport());
  process.stderr.write("CCX admin MCP: ready.\n");
}

export function registerAllTools(server: McpServer) {
  registerCheck(server);
  registerCmonVersion(server);
  registerCountDatastores(server);
  registerCountUsers(server);
  registerListVpcs(server);
  registerListDatastores(server);
  registerGetDatastore(server);
  registerListNodes(server);
  registerGetDatastoreAudit(server);
  registerDeleteDatastore(server);
  registerListUsers(server);
  registerSuspendUser(server);
  registerUnsuspendUser(server);
  registerDeleteUser(server);
  registerBillingUsage(server);
}

// Only start the server when executed directly, so tests can import registerAllTools.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`CCX admin MCP fatal error: ${errorMessage(err)}\n`);
    process.exit(1);
  });
}
