"use server"

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { getBaseUrl } from "@/lib/base-url"

async function resolveBaseUrl() {
  const hdrs = await headers()
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host")
  const protocol = hdrs.get("x-forwarded-proto") || "https"
  if (host) {
    return `${protocol}://${host}`
  }
  return getBaseUrl().replace(/\/$/, "")
}

export async function GET() {
  const baseUrl = await resolveBaseUrl()

  const metadata = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/v1/oauth/token`,
    registration_endpoint: `${baseUrl}/api/v1/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [
      "tasks:read",
      "tasks:write",
      "lists:read",
      "comments:read",
      "comments:write"
    ],
    service_documentation: `${baseUrl}/settings/api-access`,
  }

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=300"
    },
  })
}
