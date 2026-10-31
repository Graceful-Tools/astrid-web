import type { NextApiRequest } from "next"
import type { AstridMCPServerOptions } from "../../mcp/mcp-server-oauth"

interface AuthExtractionResult {
  options: AstridMCPServerOptions
  authSignature: string | null
}

const HEADER_BASE_URL = "x-astrid-api-base-url"
const HEADER_ACCESS_TOKEN = "x-astrid-access-token"
const HEADER_CLIENT_ID = "x-astrid-client-id"
const HEADER_CLIENT_SECRET = "x-astrid-client-secret"
const HEADER_LIST_ID = "x-astrid-list-id"

export function extractAuthContext(req: NextApiRequest): AuthExtractionResult | null {
  let accessToken: string | undefined
  let clientId: string | undefined
  let clientSecret: string | undefined

  const authHeader = req.headers.authorization
  let authSignature: string | null = null

  if (authHeader?.startsWith("Bearer ")) {
    accessToken = authHeader.slice(7).trim()
    authSignature = authHeader.trim()
  } else if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8")
    const separatorIndex = decoded.indexOf(":")
    if (separatorIndex !== -1) {
      clientId = decoded.slice(0, separatorIndex)
      clientSecret = decoded.slice(separatorIndex + 1)
      authSignature = authHeader.trim()
    }
  }

  const headerAccessToken = headerValue(req, HEADER_ACCESS_TOKEN)
  if (headerAccessToken) {
    accessToken = headerAccessToken
    authSignature = `token ${headerAccessToken}`
  }

  const headerClientId = headerValue(req, HEADER_CLIENT_ID)
  const headerClientSecret = headerValue(req, HEADER_CLIENT_SECRET)
  if (headerClientId && headerClientSecret) {
    clientId = headerClientId
    clientSecret = headerClientSecret
    authSignature = `client ${headerClientId}:${headerClientSecret}`
  }

  const defaultListId = headerValue(req, HEADER_LIST_ID) || null
  const baseUrl = headerValue(req, HEADER_BASE_URL)

  if (!accessToken && (!clientId || !clientSecret)) {
    return null
  }

  return {
    authSignature,
    options: {
      baseUrl: baseUrl || undefined,
      clientId,
      clientSecret,
      accessToken,
      defaultListId,
    },
  }
}

export function buildAuthSignature(req: NextApiRequest): string | null {
  const authHeader = req.headers.authorization
  if (authHeader) {
    return authHeader.trim()
  }

  const headerAccessToken = headerValue(req, HEADER_ACCESS_TOKEN)
  if (headerAccessToken) {
    return `token ${headerAccessToken}`
  }

  const headerClientId = headerValue(req, HEADER_CLIENT_ID)
  const headerClientSecret = headerValue(req, HEADER_CLIENT_SECRET)
  if (headerClientId && headerClientSecret) {
    return `client ${headerClientId}:${headerClientSecret}`
  }

  return null
}

export async function readRequestBody(req: NextApiRequest): Promise<string> {
  if (!req.readable) {
    return ""
  }
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function headerValue(req: NextApiRequest, header: string): string | undefined {
  const value = req.headers[header] || req.headers[header.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0]
  }
  return value as string | undefined
}
