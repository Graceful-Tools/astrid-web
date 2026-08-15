/**
 * PATCH /api/user/mcp-settings — the access-level validator must accept exactly
 * the values Prisma's MCPAccessLevel enum defines (task 87e19910).
 *
 * The validator read z.enum(['READ', 'write', 'both']) against a Prisma enum of
 * READ | WRITE | BOTH, so the two canonical values WRITE and BOTH were rejected
 * with a 400.
 *
 * The lowercase pair DID work: the handler called .toUpperCase() before writing.
 * An earlier version of this test — and the commit message with it — claimed
 * they reached the driver and caused a 500. That was wrong, and it was wrong
 * because I read the schema without reading the handler forty lines below it.
 * The bug was one-directional: canonical input refused, never corrupted.
 *
 * The route now upper-cases on parse and validates against the canonical list,
 * so both cases are accepted and the parsed value is the value written.
 *
 * Asserted against the Prisma enum rather than a hardcoded list, so a value
 * added to the schema fails here instead of at a caller.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const ROUTE = join(ROOT, 'app/api/user/mcp-settings/route.ts')

/** The enum members Prisma actually defines. */
function prismaAccessLevels(): string[] {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
  const block = schema.match(/enum MCPAccessLevel \{([^}]*)\}/)
  if (!block) throw new Error('MCPAccessLevel enum not found in schema.prisma')
  return block[1].split('\n').map(l => l.trim()).filter(Boolean)
}

/** The canonical values the route validates against. */
function routeAccessLevels(): string[] {
  const src = readFileSync(ROUTE, 'utf8')
  const m = src.match(/MCP_ACCESS_LEVELS = \[([^\]]*)\]/)
  if (!m) throw new Error('MCP_ACCESS_LEVELS not found in route')
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

describe('mcp-settings access level validation (task 87e19910)', () => {
  it('accepts every value Prisma defines', () => {
    const missing = prismaAccessLevels().filter(v => !routeAccessLevels().includes(v))
    expect(missing, `rejected with 400 despite being valid: ${missing.join(', ')}`).toEqual([])
  })

  it('accepts nothing Prisma does not define', () => {
    const extra = routeAccessLevels().filter(v => !prismaAccessLevels().includes(v))
    expect(extra, `would be written but Prisma rejects: ${extra.join(', ')}`).toEqual([])
  })

  it('still accepts the lowercase spellings that worked before', () => {
    // These were valid input under the old mixed-case enum, so narrowing to
    // canonical-only would have been a silent regression rather than a fix.
    const src = readFileSync(ROUTE, 'utf8')
    expect(src).toMatch(/toUpperCase\(\)/)
    expect(src).toMatch(/preprocess/)
  })
})
