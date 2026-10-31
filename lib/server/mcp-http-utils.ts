import type { NextApiRequest } from "next"
import { NextRequest } from "next/server"
import { BRAND, brandOrigin, mcpDefaultBaseUrl } from "@/lib/brand/config"
import { authenticateAPI, UnauthorizedError } from "@/lib/api-auth-middleware"
import { sameOrigin } from "@/lib/auth-host"
import { createHash } from "crypto"
import type { AstridMCPServerOptions } from "../../mcp/mcp-server-oauth"

interface AuthExtractionResult {
  options: AstridMCPServerOptions
  authSignature: string | null
}

export function mcpAuthChallenge(baseUrl: string, invalidToken = false): string {
  const metadata = `${baseUrl}/.well-known/oauth-protected-resource/mcp`
  return `Bearer resource_metadata="${metadata}"${invalidToken ? ', error="invalid_token"' : ''}`
}

export function mcpRequestBaseUrl(req: NextApiRequest): string {
  const host = req.headers.host || BRAND.domain
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"
  return `${proto}://${host}`
}

export async function validateMCPAuthContext(
  options: AstridMCPServerOptions,
  localOrigin = brandOrigin(),
): Promise<void> {
  if (!options.accessToken) return // Basic credentials use the client-credentials flow.

  const baseUrl = options.baseUrl || mcpDefaultBaseUrl()
  const canonicalOrigins = [brandOrigin(), `https://www.${BRAND.domain}`]
  const isLocal = sameOrigin(baseUrl, localOrigin) ||
    (canonicalOrigins.includes(baseUrl) && canonicalOrigins.includes(localOrigin))
  if (!isLocal) {
    // Use the same explicitly selected backend as the API client. Never follow a
    // redirect with a credential or let a backend browser session replace it.
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/oauth/validate`, {
      method: "GET",
      headers: { Authorization: `Bearer ${options.accessToken}` },
      redirect: "error",
    })
    if (response.status === 401) throw new UnauthorizedError()
    if (response.status !== 204) {
      throw new Error(`MCP backend token validation failed: HTTP ${response.status}`)
    }
    return
  }

  // Only validate the credential MCP forwards, never an unrelated browser cookie.
  // The shared API validator supports both OAuth and legacy MCP bearer tokens.
  await authenticateAPI(new NextRequest(`https://${BRAND.domain}/mcp`, {
    headers: { Authorization: `Bearer ${options.accessToken}` },
  }), undefined, { tokenOnly: true })
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
  if (authHeader?.startsWith("Bearer ")) {
    accessToken = authHeader.slice(7).trim()
  } else if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8")
    const separatorIndex = decoded.indexOf(":")
    if (separatorIndex !== -1) {
      clientId = decoded.slice(0, separatorIndex)
      clientSecret = decoded.slice(separatorIndex + 1)
    }
  }

  const headerAccessToken = headerValue(req, HEADER_ACCESS_TOKEN)
  if (headerAccessToken) {
    accessToken = headerAccessToken
  }

  const headerClientId = headerValue(req, HEADER_CLIENT_ID)
  const headerClientSecret = headerValue(req, HEADER_CLIENT_SECRET)
  if (headerClientId && headerClientSecret) {
    clientId = headerClientId
    clientSecret = headerClientSecret
  }

  const defaultListId = headerValue(req, HEADER_LIST_ID) || null
  const baseUrl = headerValue(req, HEADER_BASE_URL) || mcpDefaultBaseUrl()

  if (!accessToken && (!clientId || !clientSecret)) {
    return null
  }

  return {
    authSignature: createHash("sha256").update(JSON.stringify([
      baseUrl,
      accessToken ? ["token", accessToken] : ["client", clientId, clientSecret],
    ])).digest("hex"),
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
  return extractAuthContext(req)?.authSignature ?? null
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
