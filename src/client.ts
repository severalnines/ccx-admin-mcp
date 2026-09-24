import {
  clearSession,
  getBaseUrl,
  getBasicHeaders,
  getSessionHeaders,
  hasBasicCredentials,
  hasSessionCredentials,
  isSessionActive,
  loginSession,
} from "./auth.js";

/**
 * Which credentials an endpoint accepts. The admin REST server mounts each
 * route with exactly one middleware: `session` (admin user login cookie),
 * `basic` (ADMIN_AUTH_USERNAME/PASSWORD) or `any` (either).
 */
export type AuthMode = "session" | "basic" | "any";

export class ApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    message: string,
  ) {
    super(`API error ${status} on ${path}: ${message}`);
    this.name = "ApiError";
  }
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/** Pick the concrete auth to use for a request, or throw when it is not configured. */
function resolveAuth(mode: AuthMode): "session" | "basic" {
  if (mode === "session") {
    if (!hasSessionCredentials()) {
      throw new AuthConfigError(
        "This endpoint needs an admin user session. Set CCX_ADMIN_USERNAME and CCX_ADMIN_PASSWORD (k8s secret admin-users).",
      );
    }
    return "session";
  }
  if (mode === "basic") {
    if (!hasBasicCredentials()) {
      throw new AuthConfigError(
        "This endpoint only accepts HTTP basic auth. Set CCX_ADMIN_BASIC_USERNAME and CCX_ADMIN_BASIC_PASSWORD (k8s secret admin-basic-auth).",
      );
    }
    return "basic";
  }
  if (hasSessionCredentials()) return "session";
  if (hasBasicCredentials()) return "basic";
  throw new AuthConfigError(
    "No admin credentials configured. Set CCX_ADMIN_USERNAME/CCX_ADMIN_PASSWORD or CCX_ADMIN_BASIC_USERNAME/CCX_ADMIN_BASIC_PASSWORD.",
  );
}

async function authHeaders(auth: "session" | "basic"): Promise<Record<string, string>> {
  if (auth === "basic") return getBasicHeaders();
  if (!isSessionActive()) await loginSession();
  return getSessionHeaders();
}

export interface RequestOptions {
  auth?: AuthMode;
  body?: unknown;
  params?: Record<string, string | undefined>;
}

async function request(
  method: string,
  path: string,
  opts: RequestOptions = {},
  retried = false,
): Promise<unknown> {
  const auth = resolveAuth(opts.auth ?? "session");
  const url = new URL(`${getBaseUrl()}/api${path}`);
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    ...(await authHeaders(auth)),
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // Session expired: log in again once and retry.
  if (response.status === 401 && auth === "session" && !retried) {
    clearSession();
    return request(method, path, opts, true);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(response.status, path, text || response.statusText);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

export function get(path: string, opts: RequestOptions = {}): Promise<unknown> {
  return request("GET", path, opts);
}

export function post(path: string, opts: RequestOptions = {}): Promise<unknown> {
  return request("POST", path, opts);
}

export function del(path: string, opts: RequestOptions = {}): Promise<unknown> {
  return request("DELETE", path, opts);
}
