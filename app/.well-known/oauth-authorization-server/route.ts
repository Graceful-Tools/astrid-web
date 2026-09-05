"use server"

import { capabilityGate } from '@/lib/brand/capabilities'
import { NextResponse } from "next/server"
import { resolveDiscoveryBaseUrl } from "@/lib/oauth/discovery-base-url"

export async function GET() {
  // Gated like its sibling oauth-protected-resource/mcp: a deployment with MCP
  // switched off should not advertise an authorization server for it.
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  const baseUrl = await resolveDiscoveryBaseUrl()

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
