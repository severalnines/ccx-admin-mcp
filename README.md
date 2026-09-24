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

## Quick start

```bash
git clone <this repo> ccx-admin-mcp
cd ccx-admin-mcp
npm install && npm run build
cp .env.example .env     # fill in CCX_BASE_URL and the credentials
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

Destructive tools are blocked until you opt out with `CCX_PROTECT=false`
(or `--protect false`). While protected, these tools return a BLOCKED error
without calling the API:

- `ccx_admin_delete_datastore`
- `ccx_admin_delete_user`
- `ccx_admin_suspend_user`

Deleting additionally needs `confirm: true` in the tool call.

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
| `ccx_admin_delete_datastore` | session | **Force-delete** any datastore. Protected + `confirm` |

### Users

| Tool | Auth | Description |
|------|------|-------------|
| `ccx_admin_list_users` | session | All users; filters `login`, `name`, `suspended`, `deleted`, plus `limit`/`offset` |
| `ccx_admin_suspend_user` | session | Suspend with a reason. Protected |
| `ccx_admin_unsuspend_user` | session | Lift a suspension |
| `ccx_admin_delete_user` | session | Delete a user. Protected + `confirm` |

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
