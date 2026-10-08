// @vitest-environment node
/**
 * AWTD-1039: Playwright's signed-in state is a minted NextAuth JWT.
 *
 * Password sign-in was removed from the app (Google OAuth, Apple and passkeys
 * only), so the old `e2e/auth.setup.ts` — which clicked a "Legacy
 * email/password" link — could never sign in, whatever credentials were put in
 * `.env.local`. Nothing ran it anyway: CI provisions `.auth/*.json` with
 * `scripts/create-e2e-auth-state.ts`, which wrote database Session rows. The API
 * accepts those through its mobile fallback, but the web UI reads only the JWT,
 * so a browser carrying one was signed out and no signed-in UI check could run.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { decode } from 'next-auth/jwt'
import {
  mintSessionToken,
  sessionCookieName,
  sessionStorageState,
} from '../../e2e/utils/minted-session'

const SECRET = 'test-secret-for-awtd-1039'
const USER = { id: 'user-awtd-1039', email: 'playwright-owner@example.test', name: 'Playwright', image: null }
const root = path.resolve(__dirname, '../..')

describe('AWTD-1039: minted Playwright session', () => {
  it('mints a JWT the app decodes to the test user, with the fields the session callback reads', async () => {
    const token = await mintSessionToken(USER, SECRET)
    const decoded = await decode({ token, secret: SECRET })

    expect(decoded?.id).toBe(USER.id)
    expect(decoded?.sub).toBe(USER.id)
    expect(decoded?.email).toBe(USER.email)
    expect(decoded?.name).toBe(USER.name)
  })

  it('names the cookie the way NextAuth does for the origin under test', () => {
    expect(sessionCookieName('http://localhost:3000')).toBe('next-auth.session-token')
    expect(sessionCookieName('https://preview.example.test')).toBe('__Secure-next-auth.session-token')
  })

  it('writes a storage state carrying the session cookie for the base URL host', () => {
    const state = sessionStorageState('tok', 'http://localhost:3000')

    expect(state.origins).toEqual([])
    expect(state.cookies).toHaveLength(1)
    expect(state.cookies[0]).toMatchObject({
      name: 'next-auth.session-token',
      value: 'tok',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    })
    expect(state.cookies[0].expires).toBeGreaterThan(Date.now() / 1000)
  })

  it('the CI provisioner mints JWTs instead of database Session rows', () => {
    const script = fs.readFileSync(path.join(root, 'scripts/create-e2e-auth-state.ts'), 'utf8')

    expect(script).toMatch(/mintSessionToken/)
    expect(script).not.toMatch(/prisma\.session\./)
  })

  it('no setup depends on password sign-in', () => {
    expect(fs.existsSync(path.join(root, 'e2e/auth.setup.ts'))).toBe(false)
  })
})
