#!/usr/bin/env node

import http, { IncomingMessage, ServerResponse } from "node:http"
import { BRAND } from "../lib/brand/config"
import { AddressInfo } from "node:net"
import { URL } from "node:url"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import AstridMCPServerOAuth from "./mcp-server-oauth"

type TransportEntry = {
  transport: SSEServerTransport
  server: AstridMCPServerOAuth
}

const PORT = Number(process.env.ASTRID_MCP_HTTP_PORT || process.env.PORT || 8787)
const SSE_PATH = process.env.ASTRID_MCP_SSE_PATH || "/mcp"
const POST_PATH = process.env.ASTRID_MCP_POST_PATH || "/mcp/messages"
const HEALTH_PATH = process.env.ASTRID_MCP_HEALTH_PATH || "/healthz"
const AUTH_TOKEN = process.env.ASTRID_MCP_HTTP_AUTH_TOKEN || process.env.ASTRID_MCP_AUTH_TOKEN

const enableDnsProtection = process.env.ASTRID_MCP_ENABLE_DNS_PROTECTION === "true"
const allowedHosts = process.env.ASTRID_MCP_ALLOWED_HOSTS
  ?.split(",")
  .map(host => host.trim())
  .filter(Boolean)
const allowedOrigins = process.env.ASTRID_MCP_ALLOWED_ORIGINS
  ?.split(",")
  .map(origin => origin.trim())
  .filter(Boolean)

const transportSecurityOptions =
  enableDnsProtection || (allowedHosts && allowedHosts.length) || (allowedOrigins && allowedOrigins.length)
    ? {
        enableDnsRebindingProtection: enableDnsProtection,
        allowedHosts: allowedHosts && allowedHosts.length ? allowedHosts : undefined,
        allowedOrigins: allowedOrigins && allowedOrigins.length ? allowedOrigins : undefined,
      }
    : undefined

const transports = new Map<string, TransportEntry>()

const server = http.createServer(async (req, res) => {
  const requestUrl = parseUrl(req)

  if (!requestUrl) {
    res.writeHead(400).end("Invalid request URL")
    return
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("Unauthorized")
    return
  }

  if (req.method === "GET" && requestUrl.pathname === SSE_PATH) {
    await handleSseHandshake(req, res)
    return
  }

  if (req.method === "POST" && requestUrl.pathname === POST_PATH) {
    await handlePostMessage(req, res, requestUrl.searchParams.get("sessionId"))
    return
  }

  if (req.method === "GET" && requestUrl.pathname === HEALTH_PATH) {
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }))
    return
  }

  res.writeHead(404).end("Not Found")
})

server.listen(PORT, () => {
  const address = server.address() as AddressInfo
  console.log(
    `${BRAND.appName} MCP HTTP/SSE server listening on port ${address?.port ?? PORT} (SSE path: ${SSE_PATH}, messages path: ${POST_PATH})`
  )
  if (AUTH_TOKEN) {
    console.log("🔒 Authorization required via Authorization header (Bearer token)")
  } else {
    console.warn(`⚠️  No ASTRID_MCP_HTTP_AUTH_TOKEN set. Anyone with the URL can issue ${BRAND.appName} API calls.`)
  }
})

const shutdown = async () => {
  console.log(`Shutting down ${BRAND.appName} MCP HTTP server...`)
  server.close()
  for (const [sessionId, entry] of transports.entries()) {
    try {
      await entry.transport.close()
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error)
    }
  }
  transports.clear()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

async function handleSseHandshake(req: IncomingMessage, res: ServerResponse) {
  try {
    const transport = new SSEServerTransport(POST_PATH, res, transportSecurityOptions)
    const sessionId = transport.sessionId
    const astridServer = new AstridMCPServerOAuth()

    transports.set(sessionId, { transport, server: astridServer })
    transport.onclose = () => {
      transports.delete(sessionId)
    }

    await astridServer.startWithTransport(transport, "sse")
    console.log(`✅ SSE session established (sessionId=${sessionId})`)
  } catch (error) {
    console.error("Failed to establish SSE session:", error)
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE session")
    }
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string | null
) {
  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId parameter")
    return
  }

  const entry = transports.get(sessionId)

  if (!entry) {
    res.writeHead(404).end("Session not found")
    return
  }

  try {
    const rawBody = await readRequestBody(req)
    let parsedBody: any = undefined

    if (rawBody.length > 0) {
      try {
        parsedBody = JSON.parse(rawBody)
      } catch (error) {
        res.writeHead(400).end("Invalid JSON payload")
        return
      }
    }

    await entry.transport.handlePostMessage(req as any, res, parsedBody)
  } catch (error) {
    console.error(`Error handling POST for session ${sessionId}:`, error)
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process MCP message")
    }
  }
}

function parseUrl(req: IncomingMessage) {
  try {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
  } catch (error) {
    console.error("Failed to parse request URL:", error)
    return null
  }
}

function isAuthorized(req: IncomingMessage) {
  if (!AUTH_TOKEN) {
    return true
  }

  const header = req.headers["authorization"]
  if (!header) {
    return false
  }

  if (header === AUTH_TOKEN) {
    return true
  }

  if (header === `Bearer ${AUTH_TOKEN}`) {
    return true
  }

  return false
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}
