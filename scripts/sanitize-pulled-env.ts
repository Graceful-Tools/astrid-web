#!/usr/bin/env tsx
/**
 * Make `vercel pull`'s output safe for `vercel build` to consume.
 *
 * A Vercel env var stored as **Secret** cannot be read back, so `vercel pull`
 * writes the literal string `[SENSITIVE]` in its place — deliberately, so a
 * redacted value is distinguishable from an empty one. `vercel build` then
 * loads that file, and the build receives the string `"[SENSITIVE]"` as the
 * value (vercel/vercel#17514).
 *
 * Nothing good follows from that. On 2026-10-25 it failed the production deploy
 * twice over:
 *
 *   DATABASE_URL="[SENSITIVE]"       → P1013: "The provided database string is
 *                                      invalid. The scheme is not recognized"
 *   VAPID_PRIVATE_KEY="[SENSITIVE]"  → "Vapid private key must be a URL safe
 *                                      Base 64", thrown at MODULE SCOPE by
 *                                      lib/push-notification-service.ts while
 *                                      `next build` collected route config, so
 *                                      the whole build exited 1.
 *
 * Dropping the line is the right answer rather than inventing a value: the
 * build has no business reading a runtime secret, and production gets the real
 * value injected at runtime either way. An absent variable also lets presence
 * presence guards do what they were written to do, which a
 * non-empty placeholder defeats.
 *
 * The two Prisma datasource variables are the exception. `npm run build` runs
 * `npx prisma generate` unconditionally and Prisma hard-fails (P1012) on a
 * datasource env var that is merely *undefined*, so those get the same
 * unreachable localhost placeholder the workflow's drift check already uses.
 * Nothing connects: `next build` never does, and
 * scripts/lib/build-migration-policy.js refuses to migrate a localhost URL.
 */

import { readFileSync, writeFileSync } from 'node:fs'

/** What `vercel pull` writes in place of a value it may not read. */
export const SENSITIVE_PLACEHOLDER = '[SENSITIVE]'

/** Unreachable, and shaped enough for Prisma to load the schema. */
export const BUILD_DB_PLACEHOLDER = 'postgresql://x:x@localhost:5432/x'

/** Datasource vars in prisma/schema.prisma: defined or `prisma generate` dies. */
export const REQUIRED_BY_PRISMA = ['DATABASE_URL', 'DATABASE_URL_DIRECT'] as const

function unquote(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(["'])(.*)\1$/.exec(trimmed)
  return quoted ? quoted[2] : trimmed
}

export interface SanitizeResult {
  contents: string
  /** Keys whose redacted value was dropped. */
  removed: string[]
  /** Keys given the build placeholder because Prisma requires them. */
  placeheld: string[]
}

export function sanitizePulledEnv(contents: string): SanitizeResult {
  const removed: string[] = []
  const kept: string[] = []

  for (const line of contents.split('\n')) {
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (assignment && unquote(assignment[2]) === SENSITIVE_PLACEHOLDER) {
      removed.push(assignment[1])
      continue
    }
    kept.push(line)
  }

  const defined = new Set(
    kept
      .map(line => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1])
      .filter((key): key is string => Boolean(key)),
  )

  const placeheld: string[] = []
  for (const key of REQUIRED_BY_PRISMA) {
    if (defined.has(key)) continue
    kept.push(`${key}="${BUILD_DB_PLACEHOLDER}"`)
    placeheld.push(key)
  }

  // A trailing newline keeps the file append-safe for whatever runs next.
  let out = kept.join('\n')
  if (!out.endsWith('\n')) out += '\n'
  return { contents: out, removed, placeheld }
}

function main(): void {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: sanitize-pulled-env.ts <path to .vercel/.env.*.local>')
    process.exit(1)
  }

  const result = sanitizePulledEnv(readFileSync(path, 'utf8'))
  writeFileSync(path, result.contents)

  // Keys only — never a value, and the build log is a public artifact.
  console.log(`🧹 ${path}`)
  console.log(
    result.removed.length
      ? `   dropped ${result.removed.length} redacted secret(s): ${result.removed.join(', ')}`
      : '   no redacted secrets found',
  )
  if (result.placeheld.length) {
    console.log(`   placeheld for prisma generate: ${result.placeheld.join(', ')}`)
  }
}

if (process.argv[1]?.endsWith('sanitize-pulled-env.ts')) main()
