import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

export const BASE = "https://admin.test.ccx";
export const API = `${BASE}/api`;
export const SESSION = "ccx-session=sess-123";
export const BASIC = "Basic " + Buffer.from("basicuser:basicpass").toString("base64");

export const msw = setupServer();

/** Default handlers: admin login and a session-cookie enforcing helper. */
export function loginHandler(counter?: { logins: number }) {
  return http.post(`${API}/auth/admin-login`, async ({ request }) => {
    const body = (await request.json()) as { login: string; password: string };
    if (counter) counter.logins++;
    if (body.login !== "admin@example.com" || body.password !== "adminpass") {
      return HttpResponse.json({ err: "login failed" }, { status: 401 });
    }
    // A plain Response (not HttpResponse) so msw's cookie jar does not replay
    // the cookie into later requests; the client must send it itself.
    return new Response(JSON.stringify({ id: "admin-1", login: "admin@example.com" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "ccx-session=sess-123; Path=/; Domain=test.ccx; HttpOnly; Secure",
      },
    });
  });
}

export function requireSession(request: Request): Response | null {
  if (request.headers.get("cookie") !== SESSION) {
    return HttpResponse.json({ code: 401, error: "no session cookie" }, { status: 401 });
  }
  return null;
}

export function requireBasic(request: Request): Response | null {
  if (request.headers.get("authorization") !== BASIC) {
    return new HttpResponse(null, { status: 401, headers: { "WWW-Authenticate": "Basic realm=Restricted" } });
  }
  return null;
}

export function setEnv(opts: { session?: boolean; basic?: boolean; protect?: string } = {}) {
  process.env.CCX_BASE_URL = BASE;
  if (opts.session ?? true) {
    process.env.CCX_ADMIN_USERNAME = "admin@example.com";
    process.env.CCX_ADMIN_PASSWORD = "adminpass";
  } else {
    delete process.env.CCX_ADMIN_USERNAME;
    delete process.env.CCX_ADMIN_PASSWORD;
  }
  if (opts.basic ?? false) {
    process.env.CCX_ADMIN_BASIC_USERNAME = "basicuser";
    process.env.CCX_ADMIN_BASIC_PASSWORD = "basicpass";
  } else {
    delete process.env.CCX_ADMIN_BASIC_USERNAME;
    delete process.env.CCX_ADMIN_BASIC_PASSWORD;
  }
  if (opts.protect === undefined) delete process.env.CCX_PROTECT;
  else process.env.CCX_PROTECT = opts.protect;
}

export type ToolCaller = {
  call: (name: string, args?: Record<string, unknown>) => Promise<{ text: string; isError: boolean; json: () => unknown }>;
  listTools: () => Promise<string[]>;
  close: () => Promise<void>;
};

/** Spin up the real MCP server with all tools and a client wired over an in-memory transport. */
export async function connectTools(opts: { protect?: boolean } = {}): Promise<ToolCaller> {
  const { registerAllTools } = await import("../src/index.js");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerAllTools(server, opts.protect ?? false);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  return {
    async call(name, args = {}) {
      const res = await client.callTool({ name, arguments: args });
      const content = res.content as Array<{ type: string; text?: string }>;
      const text = content.map((c) => c.text ?? "").join("\n");
      return {
        text,
        isError: res.isError === true,
        json: () => {
          try {
            return JSON.parse(text);
          } catch {
            throw new Error(`tool returned non-JSON text: ${text}`);
          }
        },
      };
    },
    async listTools() {
      const res = await client.listTools();
      return res.tools.map((t) => t.name).sort();
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
