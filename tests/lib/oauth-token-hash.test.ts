import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { hashToken } from '@/lib/oauth/oauth-token-manager'

/**
 * Locks the token-hashing contract: OAuth access/refresh tokens are stored as
 * SHA-256 hashes so a DB/backup leak can't yield usable bearer credentials.
 * Lookup hashes the presented token and matches (with a dual-read fallback to
 * legacy plaintext rows during transition).
 */
describe('hashToken', () => {
  it('is a deterministic 64-char hex SHA-256', () => {
    const h = hashToken('astrid_abc123')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(hashToken('astrid_abc123'))
    expect(h).toBe(crypto.createHash('sha256').update('astrid_abc123').digest('hex'))
  })

  it('does not contain the plaintext token (the storage property)', () => {
    expect(hashToken('astrid_supersecret')).not.toContain('supersecret')
  })

  it('different tokens hash differently', () => {
    expect(hashToken('astrid_a')).not.toBe(hashToken('astrid_b'))
  })
})
