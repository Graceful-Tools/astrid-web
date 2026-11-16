import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * AWTD-1549: one table of what scope every /api/v1 route asks for, so the day
 * access-token scopes are enforced nobody has to discover a route by 403.
 *
 * The table is tests/fixtures/route-scope-inventory.json. A new or changed route
 * fails here until its row is regenerated (`UPDATE_ROUTE_SCOPES=1 npx vitest run
 * tests/lib/route-scope-inventory.test.ts`) and the diff is read. A route that
 * declares no scope is recorded as `none`, which is a visible choice in review.
 */
const ROOT = join(__dirname, '..', '..')
const API_DIR = join(ROOT, 'app', 'api', 'v1')
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'route-scope-inventory.json')

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return name === 'route.ts' ? [full] : []
  })
}

function literals(source: string, key: 'scopes' | 'anyOfScopes'): string[] {
  const found = new Set<string>()
  const re = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`, 'g')
  for (const m of source.matchAll(re)) {
    for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) found.add(s[1])
  }
  return [...found].sort()
}

function inventory(): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const file of routeFiles(API_DIR).sort()) {
    const src = readFileSync(file, 'utf8')
    const key = relative(API_DIR, file).split('\\').join('/')
    const all = literals(src, 'scopes')
    const any = literals(src, 'anyOfScopes')
    if (!src.includes('withAuth')) rows[key] = 'handler-auth'
    else if (all.length + any.length === 0) rows[key] = 'none'
    else rows[key] = [all.length ? `all:${all.join(',')}` : '', any.length ? `any:${any.join(',')}` : '']
      .filter(Boolean).join(' ')
  }
  return rows
}

describe('AWTD-1549: /api/v1 route scope inventory', () => {
  it('matches the committed table (regenerate with UPDATE_ROUTE_SCOPES=1)', () => {
    const current = inventory()
    if (process.env.UPDATE_ROUTE_SCOPES === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, JSON.stringify(current, null, 2) + '\n')
    }
    const committed = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>
    expect(current).toEqual(committed)
  })

  it('every route is accounted for: a scope, handler-level auth, or an explicit none', () => {
    for (const [route, row] of Object.entries(inventory())) {
      expect(row, route).toMatch(/^(handler-auth|none|all:.+|any:.+)/)
    }
  })
})
