import {
  MAX_ERROR_BODY,
  LoginError,
  clearSession,
  describeFetchError,
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
type Auth = "session" | "basic";

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

/** The credential sets to try, in order, or throw when none is configured. */
function resolveAuth(mode: AuthMode): Auth[] {
  if (mode === "session") {
    if (!hasSessionCredentials()) {
      throw new AuthConfigError(
        "This endpoint needs an admin user session. Set CCX_ADMIN_USERNAME and CCX_ADMIN_PASSWORD (k8s secret admin-users).",
      );
    }
    return ["session"];
  }
  if (mode === "basic") {
    if (!hasBasicCredentials()) {
      throw new AuthConfigError(
        "This endpoint only accepts HTTP basic auth. Set CCX_ADMIN_BASIC_USERNAME and CCX_ADMIN_BASIC_PASSWORD (k8s secret admin-basic-auth).",
      );
    }
    return ["basic"];
  }
  const auths: Auth[] = [];
  if (hasSessionCredentials()) auths.push("session");
  if (hasBasicCredentials()) auths.push("basic");
  if (auths.length === 0) {
    throw new AuthConfigError(
      "No admin credentials configured. Set CCX_ADMIN_USERNAME/CCX_ADMIN_PASSWORD or CCX_ADMIN_BASIC_USERNAME/CCX_ADMIN_BASIC_PASSWORD.",
    );
  }
  return auths;
}

async function authHeaders(auth: Auth): Promise<Record<string, string>> {
  if (auth === "basic") return getBasicHeaders();
  if (!isSessionActive()) await loginSession();
  return getSessionHeaders();
}

export interface RequestOptions {
  auth?: AuthMode;
  body?: unknown;
  params?: Record<string, string | undefined>;
}

function buildUrl(path: string, params?: Record<string, string | undefined>): URL {
  const url = new URL(`${getBaseUrl()}/api${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url;
}

/**
 * One HTTP exchange with the given credentials. Redirects are refused because
 * every request carries credentials. A 401 on a session request clears the
 * session and, for GET only, logs in again and replays once; mutations are
 * never replayed automatically since the backend may already have acted.
 */
async function exchange(method: string, path: string, opts: RequestOptions, auth: Auth, retried: boolean): Promise<unknown> {
  const url = buildUrl(path, opts.params);
  const headers: Record<string, string> = {
    ...(await authHeaders(auth)),
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      redirect: "error",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error(`${method} ${url.origin}${url.pathname} failed: ${describeFetchError(e)}`);
  }

  if (response.status === 401 && auth === "session") {
    clearSession();
    if (method === "GET" && !retried) {
      return exchange(method, path, opts, auth, true);
    }
  }

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, MAX_ERROR_BODY);
    const hint =
      response.status === 401 && auth === "session" && method !== "GET"
        ? " (session was rejected; it has been reset, retry the call)"
        : "";
    throw new ApiError(response.status, path, (text || response.statusText) + hint);
  }

  // A body-less success (204, or Content-Length: 0) is fine for mutations.
  if (response.status === 204 || response.headers.get("content-length") === "0") return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // e.g. an ingress serving the SPA for /api/*: never mistake that for an empty result.
    const text = (await response.text().catch(() => "")).slice(0, 120);
    throw new ApiError(response.status, path, `expected JSON but got ${contentType || "no content-type"}: ${text}`);
  }
  return response.json();
}

function isAuthFailure(e: unknown): boolean {
  return e instanceof LoginError || (e instanceof ApiError && e.status === 401);
}

async function request(method: string, path: string, opts: RequestOptions = {}): Promise<unknown> {
  const auths = resolveAuth(opts.auth ?? "session");
  for (let i = 0; i < auths.length; i++) {
    try {
      return await exchange(method, path, opts, auths[i], false);
    } catch (e) {
      // Fall through to the next credential set only on an auth failure, and
      // only for reads: a mutation is never sent twice (same rule as the 401 retry).
      const canFallBack = i < auths.length - 1 && method === "GET" && isAuthFailure(e);
      if (!canFallBack) throw e;
    }
  }
  throw new Error("unreachable: no credential set was tried");
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
