/**
 * RED for the 2026-10-25 production deploy failure (task bd1e0daa).
 *
 * lib/push-notification-service.ts configured web-push at module scope, guarded
 * only on the VAPID vars being *present*. When production's VAPID_PRIVATE_KEY
 * became a Vercel Secret, `vercel pull` wrote the literal string `[SENSITIVE]`
 * — non-empty, so truthy, so the guard passed — and `setVapidDetails` threw
 * "Vapid private key must be a URL safe Base 64". `next build` imports this
 * module to collect route config, so that one throw failed the entire
 * production build (run 40158070370, `Failed to collect configuration for
 * /api/coding-workflow/create`).
 *
 * A bad key for one optional feature must never fail a build.
 */
import { describe, it, expect, vi } from 'vitest'
import { configureWebPush } from '@/lib/push-notification-service'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const VALID_PUBLIC =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const VALID_PRIVATE = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls'

describe('configureWebPush (task bd1e0daa)', () => {
  it('does not throw on the [SENSITIVE] placeholder — it disables push instead', () => {
    let result: string | undefined
    expect(() => {
      result = configureWebPush({
        VAPID_PUBLIC_KEY: '[SENSITIVE]',
        VAPID_PRIVATE_KEY: '[SENSITIVE]',
      })
    }).not.toThrow()
    expect(result).toBe('rejected')
  })

  it('does not throw on any malformed key', () => {
    expect(() =>
      configureWebPush({
        VAPID_PUBLIC_KEY: VALID_PUBLIC,
        VAPID_PRIVATE_KEY: 'not==base64url==at==all',
      })
    ).not.toThrow()
  })

  it('skips cleanly when the pair is absent, as it is in most environments', () => {
    expect(configureWebPush({})).toBe('skipped')
  })

  it('still configures a valid pair', () => {
    expect(
      configureWebPush({
        VAPID_PUBLIC_KEY: VALID_PUBLIC,
        VAPID_PRIVATE_KEY: VALID_PRIVATE,
        VAPID_SUBJECT: 'mailto:test@example.com',
      })
    ).toBe('configured')
  })
})
