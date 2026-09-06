/**
 * RED for task 0845cf1c.
 *
 * OAuth and MCP tokens are stored as sha256(plaintext) so a database leak
 * cannot yield usable bearer credentials. But every lookup was a dual read:
 *
 *   accessToken: { in: [hashToken(presented), presented] }
 *
 * The second branch matches the STORED value verbatim, so anyone who could
 * read the table — a backup, a support export, a log line, a read-only SQL
 * injection elsewhere — could present the stored hash itself as the bearer and
 * be authenticated. The hashing gave no protection against exactly the threat
 * it was added for.
 *
 * Real credentials are all prefixed (astrid_mcp_…, astrid_…, astrid_refresh_…,
 * astrid_code_…) and a stored hash is bare 64-char hex, so the legacy
 * plaintext branch can be kept for un-backfilled rows without ever accepting a
 * hash. That works whether or not the backfill has run in production.
 */
import { describe, it, expect } from 'vitest'
import { hashMCPToken, mcpTokenLookup } from '@/lib/mcp-token'
import { hashToken, oauthTokenLookup } from '@/lib/oauth/oauth-token-manager'

const REAL_MCP = `astrid_mcp_${'a'.repeat(64)}`
const REAL_OAUTH = `astrid_${'b'.repeat(48)}`
const REAL_REFRESH = `astrid_refresh_${'c'.repeat(48)}`
const REAL_CODE = `astrid_code_${'d'.repeat(32)}`

describe('mcpTokenLookup', () => {
  it('never accepts a stored hash as a presented token', () => {
    const stored = hashMCPToken(REAL_MCP)

    expect(mcpTokenLookup(stored)).not.toContain(stored)
  })

  it('still matches a hashed row for a genuine token', () => {
    expect(mcpTokenLookup(REAL_MCP)).toContain(hashMCPToken(REAL_MCP))
  })

  it('still matches a legacy un-backfilled plaintext row', () => {
    expect(mcpTokenLookup(REAL_MCP)).toContain(REAL_MCP)
  })
})

describe('oauthTokenLookup', () => {
  it('never accepts a stored hash as a presented token', () => {
    const stored = hashToken(REAL_OAUTH)

    expect(oauthTokenLookup(stored)).not.toContain(stored)
  })

  it.each([
    ['access token', REAL_OAUTH],
    ['refresh token', REAL_REFRESH],
    ['authorization code', REAL_CODE],
  ])('matches both the hash and the legacy plaintext of a genuine %s', (_label, credential) => {
    const lookup = oauthTokenLookup(credential)

    expect(lookup).toContain(hashToken(credential))
    expect(lookup).toContain(credential)
  })

  it('rejects a bare hex string of hash length even without a prefix', () => {
    const hexish = 'f'.repeat(64)

    expect(oauthTokenLookup(hexish)).toEqual([hashToken(hexish)])
  })
})
