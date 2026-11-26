import { hasCapability } from '@/lib/brand/capabilities'
import type { NextApiRequest, NextApiResponse } from "next"
import AstridMCPServerOAuth from "../../../mcp/mcp-server-oauth"
import {
  extractAuthContext,
  mcpAuthChallenge,
  mcpRequestBaseUrl,
  validateMCPAuthContext,
} from "../../../lib/server/mcp-http-utils"
import { UnauthorizedError } from "@/lib/api-auth-middleware"
import { OutboundUrlError } from "@/lib/security/outbound-url"
import { createLogger } from "@/lib/logger"

export const config = {
  api: {
    bodyParser: false,
  },
}

const log = createLogger("mcp.http")
/**
 * Minimal MCP transport carrying one request/response pair (task a0e0808c).
 *
 * Streamable HTTP — what current MCP clients (Copilot, Claude) speak — POSTs
 * JSON-RPC to this single URL and reads the reply from the response body. Each
 * POST gets its own server and transport. (The legacy SSE transport, a GET
 * stream plus a separate /mcp/messages URL, was retired in AWTD-1569.)
 */
class SingleRequestTransport {
  onmessage?: (message: unknown) => void
  onerror?: (error: Error) => void
  onclose?: () => void

  private settle!: (message: unknown) => void
  readonly response: Promise<unknown>

  constructor() {
    this.response = new Promise(resolve => {
      this.settle = resolve
    })
  }

  async start(): Promise<void> {}
  async send(message: unknown): Promise<void> {
    this.settle(message)
  }
  async close(): Promise<void> {
    this.onclose?.()
  }
}

/**
 * A JSON-RPC message expects a response only when it carries an id AND a
 * method. No id → notification; id without method → the client answering one
 * of the server's requests. Neither produces a reply to wait for.
 */
function isRequest(message: unknown): message is { id: string | number; method: string } {
  if (!message || typeof message !== "object") return false
  const { id, method } = message as { id?: unknown; method?: unknown }
  return id !== undefined && id !== null && typeof method === "string"
}

/** bodyParser is disabled for SSE, so read the POST body ourselves. */
async function readJsonBody(req: NextApiRequest): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}


/**
 * Per the MCP authorization spec, an unauthenticated response points the client
 * at the resource metadata document; VS Code / Copilot and Claude Desktop read
 * it and run the OAuth flow themselves. Without this header a client gets a
 * bare 401 with nowhere to go, and connecting becomes a manual credential hunt.
 */
function sendAuthChallenge(req: NextApiRequest, res: NextApiResponse, invalidToken = false) {
  res.setHeader("WWW-Authenticate", mcpAuthChallenge(mcpRequestBaseUrl(req), invalidToken))
  res.status(401).json({
    error:
      "Provide Authorization: Bearer <astrid_access_token> or Basic <base64(clientId:secret)> (or X-Astrid-* headers)",
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Deployment does not offer MCP — answer as if the endpoint does not exist.
  if (!hasCapability('integrationMcp')) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET,POST,OPTIONS")
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    // Task 1b4260ec: extractAuthContext reads the documented X-Astrid-*
    // headers, so preflight must allow them or browser-based MCP clients
    // fail before the first request.
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-OAuth-Token, X-Astrid-Access-Token, X-Astrid-Client-Id, X-Astrid-Client-Secret, X-Astrid-List-Id, X-Astrid-API-Base-URL"
    )
    res.status(200).end()
    return
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS")
    res.status(405).json({ error: "Method Not Allowed" })
    return
  }

  const authContext = extractAuthContext(req)
  if (!authContext) {
    sendAuthChallenge(req, res)
    return
  }

  try {
    await validateMCPAuthContext(authContext.options, mcpRequestBaseUrl(req))
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      sendAuthChallenge(req, res, true)
    } else if (error instanceof OutboundUrlError) {
      log.warn({ err: error }, "Rejected MCP backend")
      res.status(400).json({ error: "Invalid MCP backend" })
    } else {
      log.error({ err: error }, "MCP authentication failed")
      res.status(500).json({ error: "Authentication error" })
    }
    return
  }

  // Streamable HTTP: one JSON-RPC request in, one response out, same URL.
  if (req.method === "POST") {
    let message: { id?: unknown }
    try {
      message = (await readJsonBody(req)) as { id?: unknown }
    } catch {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
      return
    }

    try {
      const transport = new SingleRequestTransport()
      const serverInstance = new AstridMCPServerOAuth(authContext.options)
      await serverInstance.startWithTransport(transport, "streamable-http")

      transport.onmessage?.(message)

      // A notification (no id — `notifications/initialized` is the one every
      // client sends right after initialize) gets no JSON-RPC reply, so waiting
      // for one held the POST open until the client gave up: Claude Code timed
      // out connecting after 30s while initialize and tools/list answered in
      // milliseconds. Streamable HTTP says to acknowledge it with 202 and no body.
      if (!isRequest(message)) {
        await transport.close()
        res.status(202).end()
        return
      }

      const reply = await transport.response
      await transport.close()

      res.status(200).json(reply)
    } catch (error) {
      console.error("[MCP] Streamable HTTP request failed:", error)
      res.status(500).json({
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: { code: -32603, message: "Internal error" },
      })
    }
    return
  }

  // GET: a Streamable-HTTP client's optional listen stream (AWTD-1569).
  //
  // Clients such as Claude Code open this after initialize so the server can
  // push requests and notifications. This server never pushes anything — every
  // reply goes back in the body of the POST it answers — so the stream stays
  // open and silent until the client hangs up or the function times out. That
  // is what these clients saw while GET also served the legacy SSE transport
  // (they ignored its `endpoint` event), minus the per-instance session that
  // transport kept. Answering 405 instead is a separate, client-visible decision.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  })
  // An SSE comment: flushes the headers now, and every client parser skips it.
  res.write(": listening\n\n")
  // The response (not the request) closes when the client disconnects; a GET's
  // request stream can report "close" as soon as its empty body is read.
  await new Promise<void>(resolve => {
    if (res.destroyed) resolve()
    else res.once("close", () => resolve())
  })
  if (!res.writableEnded) res.end()
}
