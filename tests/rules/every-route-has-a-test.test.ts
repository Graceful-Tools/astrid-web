/**
 * RULE — every API route is referenced by a test (ADEV-293).
 *
 * The test audit (AWTD-1327) found 35 of 255 `app/api/**\/route.ts` files that no
 * test or e2e spec referenced, by import path or by URL. `check:risk-controls`
 * triages per v1 family, so an untested route inside a tested family passed.
 *
 * A route counts as tested when some file under tests/ or e2e/ imports it
 * (`app/api/.../route`) or names its URL, with `[param]` segments wildcarded.
 * UNTESTED_ROUTES may only shrink: an entry for a route that is gone, or that
 * is now tested, fails here too.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = join(__dirname, '..', '..')

function walk(dir: string, keep: (file: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, keep, out)
    else if (keep(full)) out.push(full)
  }
  return out
}

const routes = walk(join(ROOT, 'app', 'api'), f => f.endsWith(`${sep}route.ts`)).map(f =>
  relative(ROOT, f).split(sep).join('/'),
)
const testText = [
  ...walk(join(ROOT, 'tests'), f => /\.(ts|tsx)$/.test(f)),
  ...walk(join(ROOT, 'e2e'), f => /\.(ts|tsx)$/.test(f)),
]
  .filter(f => !f.endsWith('every-route-has-a-test.test.ts'))
  .map(f => readFileSync(f, 'utf8'))
  .join('\n')

function isTested(route: string): boolean {
  const dir = route.replace(/\/route\.ts$/, '')
  if (testText.includes(`${dir}/route`)) return true
  const url = '/' + dir.replace(/^app\//, '')
  const pattern = url
    .split('/')
    .map(seg => (/^\[.*\]$/.test(seg) ? '[^/\\s\'"`?]+' : seg.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`${pattern}(?![\\w/\\[-])`).test(testText.replace(/\$\{[^}]*\}/g, 'x'))
}

/** Shrink-only. Remove an entry when its route gets a test. */
export const UNTESTED_ROUTES: readonly string[] = [
  // Possibly dead: no web caller found for sync, but astrid-ios calls /api/* too. Check it, then delete or test.
  'app/api/mcp/sync/route.ts',
  // Read-only, live (hooks/use-coding-workflow.ts calls it).
  'app/api/coding-workflow/status/[taskId]/route.ts',
  // Read-only.
  'app/api/v1/contacts/recommended/route.ts',
]

describe('every API route is referenced by a test (ADEV-293)', () => {
  const untested = routes.filter(r => !isTested(r))

  it('has no route outside the allowlist that no test references', () => {
    expect(untested.filter(r => !UNTESTED_ROUTES.includes(r))).toEqual([])
  })

  it('keeps the allowlist honest: every entry is a real, still-untested route', () => {
    expect(UNTESTED_ROUTES.filter(r => !untested.includes(r))).toEqual([])
  })

  it('keeps the allowlist at or under 10 entries', () => {
    expect(UNTESTED_ROUTES.length).toBeLessThanOrEqual(10)
  })
})
