/**
 * Task b8b21855 listed lib/astrid-api-client.ts as "a third client" to delete.
 * It is not a client: it makes no HTTP call. It mints OAuth access tokens for
 * the agent runtime, and deleting it would remove that.
 *
 * What it did duplicate is base-URL resolution — its own
 * `process.env.NEXTAUTH_URL || 'http://localhost:3000'`, beside the canonical
 * lib/base-url.ts, which also handles NEXT_PUBLIC_BASE_URL, VERCEL_URL, dynamic
 * dev ports, and strips the trailing slash production actually has on
 * NEXTAUTH_URL (task 97208a72). The copy got none of that.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const client = readFileSync('lib/astrid-api-client.ts', 'utf8')
const runtime = readFileSync('lib/astrid-agent-runtime.ts', 'utf8')

describe('astrid-api-client base URL (task b8b21855)', () => {
  it('does not define its own base-URL resolution', () => {
    expect(client).not.toMatch(/export function getBaseUrl/)
    expect(client).not.toMatch(/NEXTAUTH_URL \|\| 'http:\/\/localhost:3000'/)
  })

  it('leaves the agent runtime resolving through the canonical lib/base-url', () => {
    expect(runtime).toMatch(/from '@\/lib\/base-url'/)
    expect(runtime).not.toMatch(/getBaseUrl.*from '@\/lib\/astrid-api-client'/)
  })
})
