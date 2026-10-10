/**
 * AWTD-1110 — Sign in with Apple on web authenticates with a client secret that
 * is an ES256 JWT signed by the team's .p8 key, not a static string.
 */

import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, verify } from 'crypto'
import { appleClientSecret, APPLE_CLIENT_SECRET_LIFETIME_SECONDS } from '@/lib/auth/apple-client-secret'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

function decode(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

describe('appleClientSecret (AWTD-1110)', () => {
  const now = Date.UTC(2026, 9, 7)
  const input = { teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: 'cc.astrid.web', privateKey: pem, now }

  it('carries the header and claims Apple requires', () => {
    const [header, payload] = appleClientSecret(input).split('.')
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' })
    expect(decode(payload)).toEqual({
      iss: 'TEAM123456',
      sub: 'cc.astrid.web',
      aud: 'https://appleid.apple.com',
      iat: now / 1000,
      exp: now / 1000 + APPLE_CLIENT_SECRET_LIFETIME_SECONDS,
    })
  })

  it('stays inside Apple’s six-month cap', () => {
    expect(APPLE_CLIENT_SECRET_LIFETIME_SECONDS).toBeLessThanOrEqual(15_777_000)
  })

  it('is signed with the key, as a raw (r‖s) ES256 signature', () => {
    const [header, payload, signature] = appleClientSecret(input).split('.')
    const ok = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    )
    expect(ok).toBe(true)
  })

  it('accepts a key pasted with escaped newlines, as env vars often hold it', () => {
    const escaped = pem.replace(/\n/g, '\\n')
    const [header, payload, signature] = appleClientSecret({ ...input, privateKey: escaped }).split('.')
    expect(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true)
  })
})
