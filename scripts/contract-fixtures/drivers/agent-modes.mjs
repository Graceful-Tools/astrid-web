// Calls the GET agent-modes route with a fixed auth identity and an empty saved settings row.
// Invoked by scripts/export-contract-fixtures.ts.
//
// Usage: node scripts/contract-fixtures/drivers/agent-modes.mjs <path-to-astrid-web>

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'
import { state } from './stubs/agent-protocol-state.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/agent-modes.mjs <path-to-astrid-web>')
  process.exit(2)
}

process.env.BRAND_AGENT_EMAIL_DOMAIN = 'astrid.cc'
registerWebAliases(webRoot, {
  '@/lib/prisma': join(here, 'stubs', 'agent-protocol-prisma.mjs'),
  '@/lib/api-auth-wrapper': join(here, 'stubs', 'agent-protocol-with-auth.mjs'),
})
state.mcpSettings = null

const { GET } = await import(pathToFileURL(join(webRoot, 'app/api/v1/users/me/agent-modes/route.ts')).href)
const response = await GET(new Request('https://astrid.cc/api/v1/users/me/agent-modes'))

console.log(JSON.stringify({
  $source: 'scripts/contract-fixtures/drivers/agent-modes.mjs — GET /api/v1/users/me/agent-modes',
  ...(await response.json()),
}))
