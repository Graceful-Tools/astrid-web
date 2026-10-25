/**
 * The client secret for Sign in with Apple on web (AWTD-1110, spec §6.2).
 *
 * Apple has no static client secret: it is an ES256 JWT, signed with the team's
 * .p8 key, naming the Services ID as its subject. Apple rejects one valid for
 * more than six months, so it is minted at boot rather than stored — a server
 * instance never lives anywhere near the lifetime below.
 *
 * Node's crypto rather than jose: NextAuth builds its providers synchronously,
 * and jose only signs asynchronously.
 */

import { createPrivateKey, sign } from 'crypto'

/** 150 days — inside Apple's cap of 15,777,000 seconds (six months). */
export const APPLE_CLIENT_SECRET_LIFETIME_SECONDS = 150 * 24 * 60 * 60

export interface AppleClientSecretInput {
  teamId: string
  keyId: string
  /** The Services ID — the web client id. */
  clientId: string
  /** The .p8 key, PEM. Escaped `\n`s, as env vars often hold it, are accepted. */
  privateKey: string
  now?: number
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function appleClientSecret({ teamId, keyId, clientId, privateKey, now = Date.now() }: AppleClientSecretInput): string {
  const iat = Math.floor(now / 1000)
  const signingInput = `${base64url({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${base64url({
    iss: teamId,
    sub: clientId,
    aud: 'https://appleid.apple.com',
    iat,
    exp: iat + APPLE_CLIENT_SECRET_LIFETIME_SECONDS,
  })}`
  const key = createPrivateKey(privateKey.replace(/\\n/g, '\n'))
  // JWS wants the raw r‖s pair, not the DER encoding Node produces by default.
  const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${signature.toString('base64url')}`
}
