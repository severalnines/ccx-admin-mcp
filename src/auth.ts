import type { AdminLoginResponse } from "./types.js";

let sessionCookie: string | null = null;

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getBaseUrl(): string {
  return requiredEnv("CCX_BASE_URL").replace(/\/+$/, "");
}

/** True when admin user credentials (session login) are configured. */
export function hasSessionCredentials(): boolean {
  return !!optionalEnv("CCX_ADMIN_USERNAME") && !!optionalEnv("CCX_ADMIN_PASSWORD");
}

/** True when HTTP basic auth credentials are configured. */
export function hasBasicCredentials(): boolean {
  return !!optionalEnv("CCX_ADMIN_BASIC_USERNAME") && !!optionalEnv("CCX_ADMIN_BASIC_PASSWORD");
}

/**
 * Log in as a CCX admin user via POST /api/auth/admin-login and keep the
 * ccx-session cookie for subsequent requests.
 */
export async function loginSession(): Promise<AdminLoginResponse> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/api/auth/admin-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: requiredEnv("CCX_ADMIN_USERNAME"),
      password: requiredEnv("CCX_ADMIN_PASSWORD"),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Admin login failed (${response.status}): ${text || response.statusText}`,
    );
  }

  const setCookies = response.headers.getSetCookie?.() ?? [];
  const raw = setCookies.length > 0 ? setCookies.join("\n") : (response.headers.get("set-cookie") ?? "");
  const match = raw.match(/ccx-session=([^;\n]+)/);
  if (!match) {
    throw new Error("Admin login succeeded but no ccx-session cookie was returned");
  }
  sessionCookie = match[1];

  return (await response.json()) as AdminLoginResponse;
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
