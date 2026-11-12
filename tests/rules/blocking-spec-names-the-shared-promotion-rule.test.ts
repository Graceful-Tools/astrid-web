/**
 * The blocking-dependencies spec and the queue agree on ONE promotion rule
 * (AWTD-1002).
 *
 * "Waiting until other tasks finish" already exists twice in this repo, in
 * prose: `lib/ready-queue-scope.ts` re-checks `BLOCKED-BY:` comment markers for
 * the autonomous loops, and docs/product/PROJECT_MODE.md reserves a nullable
 * `blockedByTaskId` column for the product feature that was never built. Those
 * are two descriptions of one behaviour, which is the condition under which
 * they start disagreeing — the exact failure docs/FIXALL_WORKFLOW.md was
 * written to end ("a rule written twice is a rule that disagrees with itself").
 *
 * So the spec is pinned to ONE implementation rather than left free to invent
 * a second: since 2026-11-12 that is astrid-core's Waiting rules, which web
 * calls as `waitingSettle` in lib/waiting-rules.ts. The spec must name it, it
 * must still be there, and it must still gate promotion on BOTH the blockers
 * and the date.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { settleWaitingTs } from '@/lib/waiting-rules'

const SPEC_PATH = join(process.cwd(), 'docs', 'specs', 'TASK_BLOCKING_DEPENDENCIES.md')
const NOW = new Date('2026-09-24T12:00:00.000Z')
const PAST = '2026-09-01T00:00:00.000Z'
const FUTURE = '2026-12-01T00:00:00.000Z'

describe('the task-blocking spec (AWTD-1002)', () => {
  it('exists', () => {
    expect(existsSync(SPEC_PATH), `${SPEC_PATH} is missing`).toBe(true)
  })

  const spec = existsSync(SPEC_PATH) ? readFileSync(SPEC_PATH, 'utf8') : ''

  it('names the promotion rule that already exists rather than inventing a second one', () => {
    expect(spec).toMatch(/waitingSettle/)
    expect(spec).toMatch(/lib\/waiting-rules\.ts/)
  })

  it('reconciles itself with the blockedByTaskId column PROJECT_MODE.md reserved', () => {
    const projectMode = readFileSync(
      join(process.cwd(), 'docs', 'product', 'PROJECT_MODE.md'),
      'utf8',
    )
    // PROJECT_MODE.md may drop the reservation, but while it still lists that
    // column the spec has to say what happens to it — two docs describing one
    // field differently is how the drift starts.
    if (projectMode.includes('blockedByTaskId')) {
      expect(spec).toMatch(/blockedByTaskId/)
    }
  })

  it('is reachable from the docs index', () => {
    const index = readFileSync(join(process.cwd(), 'docs', 'README.md'), 'utf8')
    expect(index).toMatch(/specs\/TASK_BLOCKING_DEPENDENCIES\.md/)
  })
})

describe('the promotion gate the spec points at', () => {
  const waiting = (dueDateTime: string) => ({ id: 't', statusRole: 'waiting', dueDateTime })

  it('holds a task while any blocker is outstanding, whatever its date says', () => {
    expect(settleWaitingTs(waiting(PAST), [{ id: 't1', completed: false }], NOW).action).toBe('stay')
  })

  it('holds a task whose blockers are clear but whose date has not arrived', () => {
    expect(settleWaitingTs(waiting(FUTURE), [{ id: 't1', completed: true }], NOW).action).toBe('stay')
  })

  it('promotes only when the blockers are clear AND the date has arrived', () => {
    expect(settleWaitingTs(waiting(PAST), [{ id: 't1', completed: true }], NOW).action).toBe('wakeToReady')
  })
})
