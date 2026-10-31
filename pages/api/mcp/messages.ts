import { hasCapability } from '@/lib/brand/capabilities'
import type { NextApiRequest, NextApiResponse } from "next"
import {
  buildAuthSignature,
  extractAuthContext,
  mcpAuthChallenge,
  mcpRequestBaseUrl,
  readRequestBody,
  validateMCPAuthContext,
} from "../../../lib/server/mcp-http-utils"
import { getSession } from "../../../lib/server/mcp-session-store"
import { UnauthorizedError } from "@/lib/api-auth-middleware"

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Deployment does not offer MCP — answer as if the endpoint does not exist.
  if (!hasCapability('integrationMcp')) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST,OPTIONS")
    res.status(200).end()
    return
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS")
    res.status(405).json({ error: "Method Not Allowed" })
    return
  }

  const sessionIdParam = req.query.sessionId
  const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId parameter" })
    return
  }

  const session = getSession(sessionId)
  if (!session) {
    res.status(404).json({ error: "Session not found" })
    return
  }

  const signature = buildAuthSignature(req)
  if (session.authSignature && signature !== session.authSignature) {
    res.setHeader("WWW-Authenticate", mcpAuthChallenge(mcpRequestBaseUrl(req), true))
    res.status(401).json({ error: "Authorization header does not match the session that initiated the stream" })
    return
  }

  try {
    const authContext = extractAuthContext(req)
    if (!authContext) {
      res.setHeader("WWW-Authenticate", mcpAuthChallenge(mcpRequestBaseUrl(req)))
      res.status(401).json({ error: "Missing MCP credentials" })
      return
    }
    await validateMCPAuthContext(authContext.options)

    const rawBody = await readRequestBody(req)
    let parsedBody: any = undefined

    if (rawBody.length) {
      try {
        parsedBody = JSON.parse(rawBody)
      } catch (error) {
        res.status(400).json({ error: "Invalid JSON payload" })
        return
      }
    }

    await session.transport.handlePostMessage(req as any, res as any, parsedBody)
  } catch (error) {
    if (error instanceof UnauthorizedError && !res.headersSent) {
      res.setHeader("WWW-Authenticate", mcpAuthChallenge(mcpRequestBaseUrl(req), true))
      res.status(401).json({ error: "Invalid or expired access token" })
      return
    }
    console.error(`[MCP] Error handling POST for session ${sessionId}:`, error)
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to process MCP message" })
    } else {
      try {
        res.end()
      } catch {
        // ignore
      }
    }
  }
}
