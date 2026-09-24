/**
 * Protection mode blocks destructive tools (delete datastore, delete user,
 * suspend user). It is ON unless CCX_PROTECT is "false" or "0".
 */
export function isProtected(): boolean {
  const val = process.env.CCX_PROTECT?.toLowerCase();
  return val !== "false" && val !== "0";
}

export function protectedError(operation: string) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `BLOCKED: "${operation}" is not allowed while protection mode is enabled. ` +
          `Protection mode blocks destructive admin operations and is ON by default. ` +
          `To disable it, set CCX_PROTECT=false (env or .env) and restart the MCP server.`,
      },
    ],
    isError: true as const,
  };
}
