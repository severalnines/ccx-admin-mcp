import type { AdminLoginResponse } from "./types.js";

let sessionCookie: string | null = null;
let loginInFlight: Promise<AdminLoginResponse> | null = null;

/** Longest slice of a backend response body that is ever put into an error. */
export const MAX_ERROR_BODY = 500;

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Validated base URL. Credentials and cookies travel on every request, so
 * anything but https is refused unless the host is local, and embedded
 * user-info, query or fragment parts are rejected outright.
 */
export function getBaseUrl(): string {
  const raw = requiredEnv("CCX_BASE_URL").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CCX_BASE_URL is not a valid URL: ${raw}`);
  }
  if (url.username || url.password) {
    throw new Error("CCX_BASE_URL must not embed credentials");
  }
  if (url.search || url.hash) {
    throw new Error("CCX_BASE_URL must not contain a query string or fragment");
  }
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("CCX_BASE_URL must use https:// (http:// is only accepted for localhost)");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** True when admin user credentials (session login) are configured. */
export function hasSessionCredentials(): boolean {
  return !!optionalEnv("CCX_ADMIN_USERNAME") && !!optionalEnv("CCX_ADMIN_PASSWORD");
}

/** True when HTTP basic auth credentials are configured. */
export function hasBasicCredentials(): boolean {
  return !!optionalEnv("CCX_ADMIN_BASIC_USERNAME") && !!optionalEnv("CCX_ADMIN_BASIC_PASSWORD");
}

export class LoginError extends Error {
  constructor(
    public status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "LoginError";
  }
}

/**
 * Log in as a CCX admin user via POST /api/auth/admin-login and keep the
 * ccx-session cookie for subsequent requests. Redirects are refused so the
 * password can never be replayed to another origin.
 */
export function loginSession(): Promise<AdminLoginResponse> {
  // Concurrent first calls share one login instead of creating N sessions.
  if (!loginInFlight) {
    loginInFlight = doLogin().finally(() => {
      loginInFlight = null;
    });
  }
  return loginInFlight;
}

async function doLogin(): Promise<AdminLoginResponse> {
  const baseUrl = getBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/auth/admin-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      body: JSON.stringify({
        login: requiredEnv("CCX_ADMIN_USERNAME"),
        password: requiredEnv("CCX_ADMIN_PASSWORD"),
      }),
    });
  } catch (e) {
    throw new LoginError(null, `Admin login request to ${baseUrl} failed: ${describeFetchError(e)}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LoginError(
      response.status,
      `Admin login failed (${response.status}): ${text.slice(0, MAX_ERROR_BODY) || response.statusText}`,
    );
  }

  const setCookies = response.headers.getSetCookie?.() ?? [];
  const raw = setCookies.length > 0 ? setCookies.join("\n") : (response.headers.get("set-cookie") ?? "");
  const match = raw.match(/ccx-session=([^;\n]+)/);
  if (!match) {
    throw new LoginError(response.status, "Admin login succeeded but no ccx-session cookie was returned");
  }
  sessionCookie = match[1];

  return (await response.json()) as AdminLoginResponse;
}

/** Human-readable reason for a failed fetch (DNS, TLS, refused redirect, ...). */
export function describeFetchError(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : "";
    return causeMsg ? `${e.message} (${causeMsg})` : e.message;
  }
  return String(e);
}

export function getSessionHeaders(): Record<string, string> {
  if (!sessionCookie) return {};
  return { Cookie: `ccx-session=${sessionCookie}` };
}

export function getBasicHeaders(): Record<string, string> {
  const user = requiredEnv("CCX_ADMIN_BASIC_USERNAME");
  const pass = requiredEnv("CCX_ADMIN_BASIC_PASSWORD");
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return { Authorization: `Basic ${token}` };
}

export function isSessionActive(): boolean {
  return sessionCookie !== null;
}

export function clearSession(): void {
  sessionCookie = null;
}
