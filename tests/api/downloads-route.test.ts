/**
 * Regression: GET /api/downloads/<file> returned 404 in production for every
 * allowed file, breaking the Settings → Coding Integration download button.
 *
 * The route does fs.readFileSync(process.cwd() + 'public/...'), but Next only
 * bundles files it can statically trace into a serverless function. `public/`
 * is served by the CDN and is NOT traced into the function, so the read threw
 * and the catch turned it into a 404. It worked locally, where the repo is on
 * disk, which is why it went unnoticed.
 *
 * Pin the two invariants that keep the endpoint working once deployed:
 *   1. every allowed file actually exists at its declared path, and
 *   2. next.config declares it in outputFileTracingIncludes for this route.
 *
 * Also pin that middleware does not swallow the static .md path.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROUTE_KEY = '/api/downloads/[filename]'

/** Parse ALLOWED_FILES out of the route without importing next/server. */
function readAllowedFilePaths(): string[] {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'app/api/downloads/[filename]/route.ts'),
    'utf8',
  )
  return [...src.matchAll(/path:\s*'([^']+)'/g)].map(m => m[1])
}

describe('downloads route (production 404 regression)', () => {
  const allowed = readAllowedFilePaths()

  it('declares at least one downloadable file', () => {
    expect(allowed.length).toBeGreaterThan(0)
  })

  it('every allowed file exists at its declared path', () => {
    for (const rel of allowed) {
      const abs = path.join(process.cwd(), rel)
      expect(fs.existsSync(abs), `missing downloadable asset: ${rel}`).toBe(true)
    }
  })

  it('bundles every allowed file into the serverless function via outputFileTracingIncludes', async () => {
    const config = (await import('../../next.config.mjs')).default
    const includes = config.outputFileTracingIncludes?.[ROUTE_KEY] ?? []

    for (const rel of allowed) {
      expect(
        includes.some((pattern: string) => pattern === rel || rel.startsWith(pattern.replace(/\*+$/, ''))),
        `${rel} is served by the route but not traced into the function — it will 404 in production`,
      ).toBe(true)
    }
  })

  it('does not route .md static assets through middleware', async () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'middleware.ts'), 'utf8')
    const matcher = src.match(/"\/\(\(\?!.*?\).\*\)"/s)?.[0] ?? ''
    expect(matcher, 'middleware matcher must exclude .md so public docs serve statically').toContain('.md')
  })
})
