# @severalnines/ccx-admin-mcp

MCP (Model Context Protocol) server for the **CCX admin API** — the SRE /
operations side of [CCX](https://severalnines.com/ccx). It lets an AI
assistant (Claude Code, Claude Desktop, Cursor, ...) list every datastore and
user across the platform, inspect nodes, jobs and audit logs, pull billing
usage, and (when explicitly unlocked) suspend users or force-delete datastores.

For the end-user API (your own datastores, backups, firewall rules, ...) use
[`@severalnines/ccx-mcp`](https://github.com/severalnines/ccx-mcp) instead.

## Credentials

The admin REST server accepts two kinds of credentials. They come from two
Kubernetes secrets in the CCX namespace:

| Secret | Keys | Env vars | Covers |
|--------|------|----------|--------|
| `admin-users` | `ADMIN_USERS` = `email:password` | `CCX_ADMIN_USERNAME`, `CCX_ADMIN_PASSWORD` | datastores, nodes, audit, users, billing, cmon version |
| `admin-basic-auth` | `ADMIN_AUTH_USERNAME`, `ADMIN_AUTH_PASSWORD` | `CCX_ADMIN_BASIC_USERNAME`, `CCX_ADMIN_BASIC_PASSWORD` | health check, datastore/user counters, VPC listing |

The admin user login is the one you want. Basic auth is optional: the counter
tools fall back to counting the full lists when it is missing, and only the
VPC listing has no fallback.

Pulling them out of a cluster:

```bash
kubectl get secret admin-users -o jsonpath='{.data.ADMIN_USERS}' | base64 -d
kubectl get secret admin-basic-auth -o jsonpath='{.data.ADMIN_AUTH_USERNAME}' | base64 -d
kubectl get secret admin-basic-auth -o jsonpath='{.data.ADMIN_AUTH_PASSWORD}' | base64 -d
```

## Installation

The server is published on npm as
[`@severalnines/ccx-admin-mcp`](https://www.npmjs.com/package/@severalnines/ccx-admin-mcp).
Node.js 18 or newer is required. Pick one of:

| Method | Command | When |
|--------|---------|------|
| `npx` (no install) | `npx -y @severalnines/ccx-admin-mcp@latest` | Default; the MCP client fetches the latest release on start |
| Global install | `npm install -g @severalnines/ccx-admin-mcp` then `ccx-admin-mcp` | Pinned version on an operator machine |
| Project dependency | `npm install @severalnines/ccx-admin-mcp` then `node node_modules/@severalnines/ccx-admin-mcp/build/index.js` | When `npx` caching or spawning causes trouble |
| From source | see below | Development, or to keep credentials in a `.env` next to the checkout |

Pin `@latest` in `npx` invocations as shown; without it `npx` may serve a
stale cached build.

### Claude Code

```bash
claude mcp add ccx-admin \
  -e CCX_BASE_URL=https://ccx.example.com \
  -e CCX_ADMIN_USERNAME=admin@example.com \
  -e CCX_ADMIN_PASSWORD='...' \
  -- npx -y @severalnines/ccx-admin-mcp@latest
```

The `-e` flags become environment variables of the registered server, so the
password is not on the server's command line each time it starts. It is still
visible in this one `claude mcp add` invocation and in your shell history; on
a shared machine prefer the JSON configuration or a `.env` file. Restart
Claude Code (or run `/mcp` and reconnect) afterwards.

### Any MCP client (JSON config)

```json
{
  "mcpServers": {
    "ccx-admin": {
      "command": "npx",
      "args": ["-y", "@severalnines/ccx-admin-mcp@latest"],
      "env": {
        "CCX_BASE_URL": "https://ccx.example.com",
        "CCX_ADMIN_USERNAME": "admin@example.com",
        "CCX_ADMIN_PASSWORD": "..."
      }
    }
  }
}
```

With a global install use `"command": "ccx-admin-mcp"` and no `args`. Keep
the file private: it holds the credentials in clear text.

### From source, with a `.env` file

```bash
git clone https://github.com/severalnines/ccx-admin-mcp.git
cd ccx-admin-mcp
npm install             # also builds (prepare script)
cp .env.example .env    # fill in CCX_BASE_URL and the credentials
claude mcp add ccx-admin -- node "$PWD/build/index.js"
```

Prefer the `.env` file (or the client's `env` block) over `--password` flags:
command-line arguments are visible to every process on the machine via `ps`.

`.env` is git-ignored and only `CCX_*` keys are read from it. The server looks
for it at `--dotenv` / `CCX_ENV_FILE` if given, otherwise at `.env` next to
`package.json`. The working directory is deliberately not searched: MCP clients
start servers inside arbitrary projects, and a `.env` there could switch
protection off or redirect the credentials. Variables already set in the
environment (or given as flags) always win over the file.

`CCX_BASE_URL` must be `https://` (plain `http://` is only accepted for
localhost), and the server never follows redirects, so the admin password and
session cookie cannot be replayed to another host.

Flags override both the environment and the file, e.g. `--protect false` to
unlock destructive tools for one registration.

### All flags

| Flag | Env var | Purpose |
|------|---------|---------|
| `--endpoint <url>` | `CCX_BASE_URL` | Base URL of the CCX deployment |
| `--username <email>` | `CCX_ADMIN_USERNAME` | Admin user login |
| `--password <pass>` | `CCX_ADMIN_PASSWORD` | Admin user password |
| `--basic-username <name>` | `CCX_ADMIN_BASIC_USERNAME` | HTTP basic auth user (optional) |
| `--basic-password <pass>` | `CCX_ADMIN_BASIC_PASSWORD` | HTTP basic auth password |
| `--protect <true\|false>` | `CCX_PROTECT` | Block destructive tools (default `true`) |
| `--dotenv <path>` | `CCX_ENV_FILE` | Explicit `.env` location (`--env-file` is taken by Node itself) |
| `-h`, `--help` | | Usage |

At startup the server validates the configuration and probes the admin login
once. A rejected password or an invalid `CCX_BASE_URL` is fatal; a network
failure is only logged, since tools log in lazily and retry. Reads that get a
401 are retried once with a fresh session; a mutation is never sent twice.

## Protection mode

Protection mode is **on by default**. While it is on, the destructive tools are
**not registered at all**: they do not appear in the tool list, so an AI
assistant cannot attempt them. The affected tools are:

- `ccx_admin_delete_datastore`
- `ccx_admin_delete_user`
- `ccx_admin_suspend_user`

To make them available, set `CCX_PROTECT=false` (or `--protect false`) and
restart the server. Every one of them then still requires `confirm: true` in
the call; without it the tool refuses and makes no request. The setting is
read once at startup and never changes while the server runs.

## Tools

### Platform

| Tool | Auth | Description |
|------|------|-------------|
| `ccx_admin_check` | either | Verify connectivity and both credential sets; shows who you are logged in as |
| `ccx_admin_cmon_version` | session | Version of the ClusterControl controller (cmon) |
| `ccx_admin_count_datastores` | basic, falls back to session | Total datastores |
| `ccx_admin_count_users` | basic and/or session | Customer count from the counter endpoint (excludes Severalnines logins in production, includes deleted) plus a list-derived breakdown when a session exists |
| `ccx_admin_list_vpcs` | basic | VPC ids known to CCX per AWS region (backend currently returns sparse data) |

### Datastores

| Tool | Auth | Description |
|------|------|-------------|
| `ccx_admin_list_datastores` | session | All datastores across all users, with owner, status and latest job. Client-side filters: `status`, `cloud_provider`, `type`, `user_login`, `name`, `job_status`, plus `limit`/`offset` |
| `ccx_admin_get_datastore` | session | One datastore with the full latest job and its DB nodes |
| `ccx_admin_list_nodes` | session | DB and load-balancer nodes: hostname, IP, role, cmon host status, instance id/type, AZ |
| `ccx_admin_get_datastore_audit` | session | Audit log lines (jobs, resource changes, info) with `from`/`to` RFC3339 bounds and `limit` |
| `ccx_admin_delete_datastore` | session | **Force-delete** any datastore. Unprotected only + `confirm` |

### Users

| Tool | Auth | Description |
|------|------|-------------|
| `ccx_admin_list_users` | session | All users; filters `login`, `name`, `suspended`, `deleted`, plus `limit`/`offset` |
| `ccx_admin_suspend_user` | session | Suspend with a reason. Unprotected only + `confirm` |
| `ccx_admin_unsuspend_user` | session | Lift a suspension |
| `ccx_admin_delete_user` | session | Delete a user. Unprotected only + `confirm` |

### Billing

| Tool | Auth | Description |
|------|------|-------------|
| `ccx_admin_billing_usage` | either | Per-datastore usage for a date range (instance hours, volume GiB-hours, IOPS, egress, backups) with totals; filters `datastore_id`, `customer_id`, `customer_reference`, `vendor` |

Example prompts:

- "Which datastores are DEGRADED or have a failed last job?"
- "Show the nodes and the audit log of datastore 936a84de-… for the last 24 hours"
- "Who owns the datastore called fancy-breeze?"
- "How many users do we have, and which are suspended?"
- "Total instance hours per customer for September"

## Development

```bash
npm run build       # tsc -> build/
npm run typecheck
npm test            # vitest, API mocked with msw
```

Tests drive the real MCP server over an in-memory transport, so every tool is
exercised end to end (argument validation, auth selection, response shaping).
The API mocks return the field names observed on a live CCX deployment.

## API coverage

Everything under `/api/admin` in the CCX OpenAPI spec is covered except the
CSV variants (`/admin/datastores/csv`, `/admin/users/csv`, billing `csv`),
which return the same data as the JSON endpoints. `/admin/v2/auth/*` is in the
spec but not mounted by the server; login goes through `/api/auth/admin-login`.
