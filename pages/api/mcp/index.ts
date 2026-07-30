import { hasCapability } from '@/lib/brand/capabilities'
import type { NextApiRequest, NextApiResponse } from "next"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import AstridMCPServerOAuth from "../../../mcp/mcp-server-oauth"
import { extractAuthContext } from "../../../lib/server/mcp-http-utils"
import { deleteSession, storeSession } from "../../../lib/server/mcp-session-store"

export const config = {
  api: {
    bodyParser: false,
  },
}

const ENABLE_DNS_PROTECTION = process.env.ASTRID_MCP_ENABLE_DNS_PROTECTION === "true"
const ALLOWED_HOSTS = (process.env.ASTRID_MCP_ALLOWED_HOSTS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean)
const ALLOWED_ORIGINS = (process.env.ASTRID_MCP_ALLOWED_ORIGINS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean)

const securityOptions =
  ENABLE_DNS_PROTECTION || ALLOWED_HOSTS.length || ALLOWED_ORIGINS.length
    ? {
        enableDnsRebindingProtection: ENABLE_DNS_PROTECTION,
        allowedHosts: ALLOWED_HOSTS.length ? ALLOWED_HOSTS : undefined,
        allowedOrigins: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : undefined,
      }
    : undefined

/**
 * Minimal MCP transport carrying one request/response pair (task a0e0808c).
 *
 * The SSE transport below keeps a long-lived stream and expects clients to POST
 * to a separate /mcp/messages URL. Streamable HTTP — what current MCP clients
 * (Copilot, Claude) speak — POSTs JSON-RPC to this single URL and reads the
 * reply from the response body. Each POST gets its own server and transport.
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
function sendAuthChallenge(req: NextApiRequest, res: NextApiResponse) {
  const host = req.headers.host || "astrid.cc"
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"
  const metadata = `${proto}://${host}/.well-known/oauth-protected-resource/mcp`
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadata}"`)
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-OAuth-Token")
    res.status(200).end()
    return
  }

  // Streamable HTTP: one JSON-RPC request in, one response out, same URL.
  if (req.method === "POST") {
    const postAuth = extractAuthContext(req)
    if (!postAuth) {
      sendAuthChallenge(req, res)
      return
    }

    let message: { id?: unknown }
    try {
      message = (await readJsonBody(req)) as { id?: unknown }
    } catch {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
      return
    }

    try {
      const transport = new SingleRequestTransport()
      const serverInstance = new AstridMCPServerOAuth(postAuth.options)
      await serverInstance.startWithTransport(transport, "streamable-http")

      transport.onmessage?.(message)
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

  if (req.method !== "GET") {
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
    const transport = new SSEServerTransport(
      process.env.ASTRID_MCP_POST_PATH || "/mcp/messages",
      res as any,
      securityOptions
    )
    const sessionId = transport.sessionId
    const serverInstance = new AstridMCPServerOAuth(authContext.options)

    storeSession(sessionId, {
      transport,
      server: serverInstance,
      authSignature: authContext.authSignature,
      createdAt: Date.now(),
    })

    transport.onclose = () => {
      deleteSession(sessionId)
    }

    await serverInstance.startWithTransport(transport, "sse")
    console.log(
      `[MCP] SSE session established (${sessionId}) for base ${authContext.options.baseUrl || "https://astrid.cc"}`
    )
  } catch (error) {
    console.error("[MCP] Failed to establish SSE session:", error)
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to establish MCP session" })
    }
  }
}
