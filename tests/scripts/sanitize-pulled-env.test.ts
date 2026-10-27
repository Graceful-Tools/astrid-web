/**
 * RED for the 2026-10-25 production deploy failures (task bd1e0daa).
 *
 * Moving production's credentials to Vercel **Secret** is what stops a workflow
 * holding the repo-level VERCEL_TOKEN from reading them. But `vercel pull`
 * writes the literal string `[SENSITIVE]` for a value it may not read, and
 * `vercel build` loads that file, so the build gets `"[SENSITIVE]"` as the
 * value (vercel/vercel#17514). Run 40158070370 died twice over:
 *
 *   DATABASE_URL="[SENSITIVE]"       → P1013, "The scheme is not recognized"
 *   VAPID_PRIVATE_KEY="[SENSITIVE]"  → "Vapid private key must be a URL safe
 *                                      Base 64", thrown at module scope by
 *                                      lib/push-notification-service.ts during
 *                                      `next build`'s config collection
 *
 * Passing placeholders in the build step's `env:` did not fix it: the pulled
 * file defines the key, so there is nothing for a process-env default to fall
 * back to. The redacted lines have to go.
 */
import { describe, it, expect } from 'vitest'
import {
  sanitizePulledEnv,
  BUILD_DB_PLACEHOLDER,
  SENSITIVE_PLACEHOLDER,
} from '@/scripts/sanitize-pulled-env'

const parse = (contents: string) =>
  Object.fromEntries(
    contents
      .split('\n')
      .map(l => /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map(m => [m[1], m[2].replace(/^(["'])(.*)\1$/, '$2')]),
  )

describe('sanitizePulledEnv (task bd1e0daa)', () => {
  it('drops a redacted secret rather than handing the build "[SENSITIVE]"', () => {
    const { contents, removed } = sanitizePulledEnv(
      `VAPID_PRIVATE_KEY="${SENSITIVE_PLACEHOLDER}"\nOTEL_SERVICE_NAME="astrid"\n`,
    )
    expect(removed).toContain('VAPID_PRIVATE_KEY')
    expect(parse(contents)).not.toHaveProperty('VAPID_PRIVATE_KEY')
    // An absent var lets `if (process.env.VAPID_PRIVATE_KEY)` guards work; a
    // non-empty placeholder is truthy and defeats them.
    expect(contents).not.toContain(SENSITIVE_PLACEHOLDER)
  })

  it('placeholds the Prisma datasource vars, which must be DEFINED or prisma generate fails', () => {
    const { contents, removed, placeheld } = sanitizePulledEnv(
      `DATABASE_URL="${SENSITIVE_PLACEHOLDER}"\nDATABASE_URL_DIRECT="${SENSITIVE_PLACEHOLDER}"\n`,
    )
    expect(removed).toEqual(['DATABASE_URL', 'DATABASE_URL_DIRECT'])
    expect(placeheld).toEqual(['DATABASE_URL', 'DATABASE_URL_DIRECT'])
    const env = parse(contents)
    expect(env.DATABASE_URL).toBe(BUILD_DB_PLACEHOLDER)
    expect(env.DATABASE_URL_DIRECT).toBe(BUILD_DB_PLACEHOLDER)
  })

  it('leaves a real pulled value alone — including one that merely contains the word', () => {
    const { contents, removed, placeheld } = sanitizePulledEnv(
      `DATABASE_URL="postgresql://u:p@db.example.com:5432/astrid"\nNOTE="mentions [SENSITIVE] inline"\n`,
    )
    expect(removed).toEqual([])
    expect(placeheld).toEqual(['DATABASE_URL_DIRECT'])
    const env = parse(contents)
    expect(env.DATABASE_URL).toBe('postgresql://u:p@db.example.com:5432/astrid')
    expect(env.NOTE).toBe('mentions [SENSITIVE] inline')
  })

  it('handles an unquoted placeholder and keeps comments and blank lines', () => {
    const { contents, removed } = sanitizePulledEnv(
      `# pulled by vercel\n\nENCRYPTION_KEY=${SENSITIVE_PLACEHOLDER}\nOTEL_SERVICE_NAME="astrid"\n`,
    )
    expect(removed).toEqual(['ENCRYPTION_KEY'])
    expect(contents).toContain('# pulled by vercel')
    expect(parse(contents).OTEL_SERVICE_NAME).toBe('astrid')
  })

  it('is idempotent — the deploy may retry', () => {
    const once = sanitizePulledEnv(`DATABASE_URL="${SENSITIVE_PLACEHOLDER}"\n`).contents
    const twice = sanitizePulledEnv(once)
    expect(twice.contents).toBe(once)
    expect(twice.removed).toEqual([])
  })
})
