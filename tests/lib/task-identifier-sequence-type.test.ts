/**
 * Regression: every task create on a project board 500'd in production from
 * 2026-10-09 23:04 UTC — `prisma.task.create()` rejected `sequence: 1146n`
 * ("Expected Int or Null, provided BigInt").
 *
 * allocateSequenceRange (AWTD-1124) returns `"nextSequence" - ${count}`. The
 * count travels as a bound parameter that Postgres types as bigint, so
 * int4 - int8 = int8, which Prisma's $queryRaw hands back as a JS BigInt. The
 * tests' fake $queryRaw returned plain numbers, so nothing caught it — a mock
 * is not evidence a query works (GITHUB_PROJECTS_WHITELABEL §13.1).
 *
 * The rule: the allocator answers a JS number whatever the driver hands back,
 * and the SQL keeps the arithmetic in integer.
 */

import { describe, it, expect, vi } from 'vitest'
import { allocateSequence, allocateSequenceRange } from '@/lib/task-identifier'

/** What Postgres actually returns for int4 - int8: a bigint. */
function bigintDriver(next: bigint, key = 'AWTD') {
  return { $queryRaw: vi.fn().mockResolvedValue([{ nextSequence: next, key }]) } as never
}

describe('task sequence allocation returns a number Prisma accepts', () => {
  it('allocateSequence answers a number when the driver returns bigint', async () => {
    const result = await allocateSequence('p-1', bigintDriver(1146n))

    expect(result).toEqual({ sequence: 1146, key: 'AWTD' })
    expect(typeof result?.sequence).toBe('number')
  })

  it('allocateSequenceRange answers a number when the driver returns bigint', async () => {
    const result = await allocateSequenceRange('p-1', 3, bigintDriver(1146n))

    expect(result).toEqual({ firstSequence: 1146, key: 'AWTD' })
    expect(typeof result?.firstSequence).toBe('number')
  })

  it('keeps the arithmetic in integer, so Postgres does not answer bigint at all', async () => {
    const driver = bigintDriver(1146n) as unknown as { $queryRaw: ReturnType<typeof vi.fn> }
    await allocateSequenceRange('p-1', 3, driver as never)

    const sql = (driver.$queryRaw.mock.calls[0][0] as { text: string }).text
    expect(sql).toMatch(/RETURNING\s+\("nextSequence"\s*-\s*\$\d+::integer\)::integer\s+AS\s+"nextSequence"/)
  })
})
