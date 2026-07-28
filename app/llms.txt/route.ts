import { NextResponse } from 'next/server'
import { getBaseUrl } from '@/lib/base-url'
import { ASTRID_DESCRIPTION, enabledIntegrationMethods, WELL_KNOWN_ENDPOINTS } from '@/lib/integration-registry'
import { BRAND } from '@/lib/brand/config'

export async function GET() {
  const baseUrl = getBaseUrl()

  const integrationLinks = enabledIntegrationMethods().map((m) => {
    const url = m.externalUrl || `${baseUrl}${m.docsPath}`
    return `- [${m.name}](${url}): ${m.tagline}`
  }).join('\n')

  const wellKnownLinks = WELL_KNOWN_ENDPOINTS.map(
    (ep) => `- [${ep.description}](${baseUrl}${ep.path})`
  ).join('\n')

  const content = `# ${BRAND.appName}

> ${ASTRID_DESCRIPTION}

## Docs

${integrationLinks}
- [Integration Guide](${baseUrl}/docs/integrate): Overview of all integration methods

## API

- Base URL: \`${baseUrl}\`
- Auth: OAuth2 Client Credentials → \`POST ${baseUrl}/api/v1/oauth/token\`
- Scopes: \`tasks:read\`, \`tasks:write\`, \`lists:read\`, \`comments:read\`, \`comments:write\`
- OpenAPI Spec: [astrid-openapi.yaml](${baseUrl}/.well-known/astrid-openapi.yaml)

## Machine-Readable Discovery

${wellKnownLinks}

## Key Concepts

- **Lists as agent instructions**: Each list's description becomes the agent's system prompt
- **Agent identities**: AI agents get \`name@${BRAND.agentEmailDomain}\` email addresses and appear as list members
- **OAuth2 everywhere**: All integrations use the same OAuth2 client_credentials flow
- **MCP operations**: POST to \`/api/mcp/operations\` with operation name and args
- **Real-time events**: SSE stream at \`/api/v1/agent/events\` for task assignments and updates
`

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
