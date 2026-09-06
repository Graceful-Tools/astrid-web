"use server"

import { BRAND } from '@/lib/brand/config'
import { capabilityGate } from '@/lib/brand/capabilities'
import { NextResponse } from "next/server"
import { resolveDiscoveryBaseUrl } from "@/lib/oauth/discovery-base-url"

export async function GET() {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  const baseUrl = await resolveDiscoveryBaseUrl()
  const resourceUrl = `${baseUrl}/mcp`

  const metadata = {
    resource: resourceUrl,
    authorization_servers: [baseUrl],
    scopes_supported: [
      "tasks:read",
      "tasks:write",
      "lists:read",
      "comments:read",
      "comments:write"
    ],
    resource_name: `${BRAND.appName} Tasks MCP`,
    resource_documentation: `${baseUrl}/docs`,
  }

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=300"
    },
  })
}
