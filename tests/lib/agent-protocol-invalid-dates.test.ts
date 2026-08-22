/**
 * enrichTaskForAgent must not throw on a missing or unparseable date
 * (task aca946b8).
 *
 * It calls `new Date(task.createdAt).toISOString()`. When the value is absent
 * or unparseable that is `Invalid Date`, and `.toISOString()` throws
 * `RangeError: Invalid time value`.
 *
 * IT NEVER BROKE A REQUEST. Both call sites in
 * app/api/v1/tasks/[id]/route.ts sit inside a try with `catch (sseError)`, so
 * the throw is caught and logged — I confirmed that by running the three
 * affected test files in isolation, where all 23 tests PASS and "Invalid time
 * value" still appears twice in the output.
 *
 * IT IS WORTH FIXING ANYWAY, because the cost is misdirection. A RangeError in
 * the output of a green run reads like a crash in the clear-a-due-date path,
 * and it cost a full second run to disprove. A scary log line during a passing
 * run teaches people to distrust green, which is how a real regression gets
 * waved through.
 *
 * A MISSING DATE BECOMES null, not a throw and not a fabricated `now`. The
 * agent payload should say "I do not know when this was created" rather than
 * assert something false.
 */

import { describe, it, expect } from 'vitest'
import { enrichTaskForAgent } from '@/lib/agent-protocol'

const baseTask = {
  id: 'task-1',
  title: 'A task',
  comments: [],
  createdAt: new Date('2026-08-16T00:00:00.000Z'),
  updatedAt: new Date('2026-08-16T00:00:00.000Z'),
}

describe('enrichTaskForAgent survives bad dates (task aca946b8)', () => {
  it('still serialises a valid task', () => {
    const enriched = enrichTaskForAgent(baseTask as never)
    expect(enriched.createdAt).toBe('2026-08-16T00:00:00.000Z')
    expect(enriched.updatedAt).toBe('2026-08-16T00:00:00.000Z')
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an unparseable string', 'not-a-date'],
  ])('does not throw when createdAt is %s', (_label, value) => {
    expect(() =>
      enrichTaskForAgent({ ...baseTask, createdAt: value } as never),
    ).not.toThrow()
  })

  it('reports an unknown date as null rather than inventing one', () => {
    // `now` would be a lie the agent cannot tell apart from a real timestamp.
    const enriched = enrichTaskForAgent({ ...baseTask, createdAt: undefined } as never)
    expect(enriched.createdAt).toBeNull()
  })

  it('does not throw on a bad comment date either', () => {
    // Same conversion, one level down, and the likelier source in practice.
    expect(() =>
      enrichTaskForAgent({
        ...baseTask,
        comments: [{ id: 'c1', content: 'hi', createdAt: undefined }],
      } as never),
    ).not.toThrow()
  })
})
