/** Helpers shared by all tools for MCP text responses. */

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

export function fail(context: string, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `${context}: ${message}` }],
    isError: true,
  };
}

/** Case-insensitive substring match; undefined/empty needle always matches. */
export function contains(haystack: string | undefined | null, needle?: string): boolean {
  if (!needle) return true;
  return (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
}

/** Case-insensitive equality; undefined/empty expected always matches. */
export function equalsCI(actual: string | undefined | null, expected?: string): boolean {
  if (!expected) return true;
  return (actual ?? "").toLowerCase() === expected.toLowerCase();
}

/** Apply offset/limit to an already-filtered list and describe the window. */
export function page<T>(items: T[], limit: number | undefined, offset: number | undefined) {
  const off = Math.max(0, offset ?? 0);
  const lim = Math.max(1, limit ?? 50);
  const slice = items.slice(off, off + lim);
  return {
    items: slice,
    pagination: {
      offset: off,
      limit: lim,
      returned: slice.length,
      matched: items.length,
      has_more: off + slice.length < items.length,
    },
  };
}
