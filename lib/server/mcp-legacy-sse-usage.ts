import type { NextApiRequest } from "next"
import { recordLegacyApiHit } from "@/lib/legacy-api-usage-service"
import { createLogger } from "@/lib/logger"

/**
 * Census of the legacy MCP SSE transport (AWTD-1461).
 *
 * The SSE transport (GET /mcp stream + POST /mcp/messages?sessionId=…) keeps its
 * sessions in a per-instance Map (lib/server/mcp-session-store.ts), so a POST
 * that lands on another instance cannot find its session. The cheap fix is to
 * drop the transport — but public docs still offer it, and Vercel's log window
 * is far too short to prove nobody uses it. So until the evidence exists, every
 * legacy touch is counted in the same durable census that gates the legacy
 * /api/* retirement (LegacyApiDailyUsage, read by scripts/legacy-usage-census.ts),
 * with its 28-day observation guard.
 *
 * How to read the rows:
 * - `/mcp/messages` POST — the unambiguous legacy signal. Only an SSE client
 *   posts here. Zero for 28 days is the bar for deleting the transport.
 * - `/mcp` GET — an SSE stream was opened. Platform ending `/streamable` means
 *   the client sent `mcp-protocol-version`, which a Streamable-HTTP client does
 *   on its optional listen GET after initialize; a legacy SSE client opens its
 *   stream before initialize, so it cannot have negotiated a version yet.
 * - `/mcp/messages#session-miss` POST — a message whose session lives on a
 *   different instance (or died with a redeploy). This is the W3 bug, counted.
 */

const log = createLogger("mcp.legacy-sse")

export type McpLegacySseEvent = "stream" | "message" | "session-miss"

const ROUTES: Record<McpLegacySseEvent, { route: string; method: string }> = {
  stream: { route: "/mcp", method: "GET" },
  message: { route: "/mcp/messages", method: "POST" },
  "session-miss": { route: "/mcp/messages#session-miss", method: "POST" },
}

function header(req: Pick<NextApiRequest, "headers">, name: string): string {
  const value = req.headers?.[name]
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

/**
 * The client's product name from its user-agent ("claude-code/2.0 (cli)" →
 * "claude-code"), lower-cased and bounded. Only the product token is kept: the
 * rest of a user-agent is version and platform noise that would split one
 * client across many census rows.
 */
export function mcpClientLabel(userAgent: string | undefined | null): string {
  const token = (userAgent ?? "").trim().split(/[\s/]/)[0] ?? ""
  const clean = token.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32)
  return clean || "unknown"
}

/** Platform bucket for a census row: `mcp:<client>`, `/streamable` if negotiated. */
export function mcpLegacyPlatform(req: Pick<NextApiRequest, "headers">): string {
  const client = `mcp:${mcpClientLabel(header(req, "user-agent"))}`
  return header(req, "mcp-protocol-version") ? `${client}/streamable` : client
}

/**
 * Count one legacy SSE touch. Fire-and-forget and best-effort by contract —
 * recordLegacyApiHit swallows its own failures, and this never awaits, so
 * telemetry can neither fail nor slow the request it describes.
 */
export function recordMcpLegacySseUsage(
  req: Pick<NextApiRequest, "headers">,
  event: McpLegacySseEvent
): void {
  const platform = mcpLegacyPlatform(req)
  if (event === "session-miss") {
    // No session id in the log: it is the only thing binding a POST to a stream.
    log.warn({ event, platform }, "MCP SSE session not found on this instance")
  }
  void recordLegacyApiHit({ ...ROUTES[event], platform }).catch(() => {})
}

/**
 * Body for a POST whose session this instance does not hold. Says why and what
 * to do, because "Session not found" alone reads as a client bug.
 */
export const SESSION_NOT_FOUND_ERROR =
  "MCP SSE session not found on this server instance. Legacy SSE sessions live on " +
  "the single instance that opened the stream, so they are lost on scale-out or " +
  "redeploy. Reconnect the SSE stream, or switch to Streamable HTTP: POST JSON-RPC " +
  "to /mcp and read the reply from the response body."
