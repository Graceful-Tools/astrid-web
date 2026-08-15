/**
 * PATCH /api/user/mcp-settings — the access-level validator must accept exactly
 * the values Prisma's MCPAccessLevel enum defines (task 87e19910).
 *
 * The validator read z.enum(['READ', 'write', 'both']) while the Prisma enum is
 * READ | WRITE | BOTH. Two of the three correct values were rejected with a 400,
 * and the two lowercase values it did accept were passed straight to Prisma,
 * which rejects them with a 500. Exactly one of three settings worked.
 *
 * Tested against the Prisma enum rather than a hardcoded list, so the next
 * value added to the schema fails here instead of at a caller.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

/** The enum members Prisma actually defines. */
function prismaAccessLevels(): string[] {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
  const block = schema.match(/enum MCPAccessLevel \{([^}]*)\}/)
  if (!block) throw new Error('MCPAccessLevel enum not found in schema.prisma')
  return block[1].split('\n').map(l => l.trim()).filter(Boolean)
}

/** The values the route's zod schema will accept. */
function routeAccessLevels(): string[] {
  const src = readFileSync(join(ROOT, 'app/api/user/mcp-settings/route.ts'), 'utf8')
  const m = src.match(/defaultNewListMcpAccessLevel:\s*z\.enum\(\[([^\]]*)\]\)/)
  if (!m) throw new Error('defaultNewListMcpAccessLevel z.enum not found in route')
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

describe('mcp-settings access level validation (task 87e19910)', () => {
  it('accepts every value Prisma defines', () => {
    const missing = prismaAccessLevels().filter(v => !routeAccessLevels().includes(v))
    expect(missing, `rejected with 400 despite being valid: ${missing.join(', ')}`).toEqual([])
  })

  it('accepts nothing Prisma will reject', () => {
    // These are the ones that reached the driver and surfaced as a 500 where
    // the caller deserved a 400 — the worse direction of the same typo.
    const extra = routeAccessLevels().filter(v => !prismaAccessLevels().includes(v))
    expect(extra, `accepted but will 500 in Prisma: ${extra.join(', ')}`).toEqual([])
  })
})
