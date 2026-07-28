"use server"

import { capabilityGate } from '@/lib/brand/capabilities'
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
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  const baseUrl = await resolveBaseUrl()
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
    resource_name: "Astrid Tasks MCP",
    resource_documentation: `${baseUrl}/docs`,
  }

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=300"
    },
  })
}
