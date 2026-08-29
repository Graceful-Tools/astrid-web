/**
 * Waiting-lane semantics for the /fixall loop (Jon, 2026-08-29).
 *
 * Ready must mean "actionable now". Anything paused on a DATE, ANOTHER TASK,
 * or an EXTERNAL EVENT lives in Waiting with a machine-readable condition, and
 * the loop's queue script re-checks those conditions on every run:
 *
 *   - a dated task parks in Waiting and returns to Ready when due
 *   - `BLOCKED-BY: <task-id>` returns to Ready when every blocker completes
 *   - `BLOCKED-ON: <reason>` surfaces for the agent to re-verify when its
 *     recheck date arrives (external facts can't be machine-verified)
 *   - Waiting with no condition at all surfaces for triage — it would rot
 *
 * Latest marker-bearing comment wins wholesale, so updating the conditions is
 * "post a new comment", not "edit history".
 */
import { describe, it, expect } from 'vitest'
import {
  parseBlockedConditions,
  classifyWaitingTask,
  shouldParkScheduledReadyTask,
  resolveReadyQueueOptions,
} from '@/lib/ready-queue-scope'

const NOW = new Date('2026-08-29T12:00:00Z')
const FUTURE = '2026-09-12T00:00:00.000Z'
const PAST = '2026-08-01T00:00:00.000Z'

describe('parseBlockedConditions', () => {
  it('reads BLOCKED-BY task ids and a BLOCKED-ON reason', () => {
    const conditions = parseBlockedConditions([
      { content: 'strategy comment', createdAt: '2026-08-01T00:00:00Z' },
      {
        content: 'Parked.\nBLOCKED-BY: 11111111-aaaa-bbbb-cccc-222222222222\nBLOCKED-ON: eslint-plugin-react ships eslint 10 support',
        createdAt: '2026-08-02T00:00:00Z',
      },
    ])
    expect(conditions.blockedBy).toEqual(['11111111-aaaa-bbbb-cccc-222222222222'])
    expect(conditions.blockedOn).toBe('eslint-plugin-react ships eslint 10 support')
  })

  it('latest marker-bearing comment wins wholesale', () => {
    const conditions = parseBlockedConditions([
      { content: 'BLOCKED-BY: 11111111-aaaa-bbbb-cccc-222222222222', createdAt: '2026-08-01T00:00:00Z' },
      { content: 'blockers cleared!\nBLOCKED-ON: the vendor fixes their API', createdAt: '2026-08-03T00:00:00Z' },
      { content: 'unrelated chatter', createdAt: '2026-08-04T00:00:00Z' },
    ])
    expect(conditions.blockedBy).toEqual([])
    expect(conditions.blockedOn).toBe('the vendor fixes their API')
  })

  it('is case-insensitive and tolerates multiple BLOCKED-BY lines', () => {
    const conditions = parseBlockedConditions([
      { content: 'blocked-by: aaaa1111-aaaa-bbbb-cccc-222222222222\nBlocked-By: bbbb1111-aaaa-bbbb-cccc-222222222222', createdAt: '2026-08-01T00:00:00Z' },
    ])
    expect(conditions.blockedBy).toHaveLength(2)
  })

  it('returns empty conditions when no comment carries a marker', () => {
    const conditions = parseBlockedConditions([{ content: 'just words', createdAt: '2026-08-01T00:00:00Z' }])
    expect(conditions.blockedBy).toEqual([])
    expect(conditions.blockedOn).toBeNull()
  })
})

describe('classifyWaitingTask', () => {
  const classify = (over: Partial<Parameters<typeof classifyWaitingTask>[0]>) =>
    classifyWaitingTask({ dueDateTime: null, now: NOW, blockedBy: [], blockedOn: null, ...over })

  it('blockers outrank everything — they must be checked first', () => {
    expect(classify({ blockedBy: ['t1'], dueDateTime: PAST })).toBe('check-blockers')
  })

  it('a future date holds the task quietly', () => {
    expect(classify({ dueDateTime: FUTURE })).toBe('hold')
    expect(classify({ dueDateTime: FUTURE, blockedOn: 'anything' })).toBe('hold')
  })

  it('a due external condition surfaces for the agent to re-verify, never auto-promotes', () => {
    expect(classify({ dueDateTime: PAST, blockedOn: 'upstream ships a fix' })).toBe('recheck')
    // No recheck date: still surfaced — invisible forever is worse than noisy.
    expect(classify({ blockedOn: 'upstream ships a fix' })).toBe('recheck')
  })

  it('a plain scheduled task promotes itself when due', () => {
    expect(classify({ dueDateTime: PAST })).toBe('promote')
  })

  it('waiting with no condition at all needs triage', () => {
    expect(classify({})).toBe('review')
  })
})

describe('shouldParkScheduledReadyTask', () => {
  it('parks a Ready task whose date is in the future', () => {
    expect(shouldParkScheduledReadyTask({ dueDateTime: FUTURE }, NOW)).toBe(true)
  })

  it('leaves due and dateless Ready tasks alone', () => {
    expect(shouldParkScheduledReadyTask({ dueDateTime: PAST }, NOW)).toBe(false)
    expect(shouldParkScheduledReadyTask({ dueDateTime: null }, NOW)).toBe(false)
  })
})

describe('--dry-run', () => {
  it('parses and defaults off', () => {
    expect(resolveReadyQueueOptions(['--harness', 'claude-code', '--dry-run'], {}).dryRun).toBe(true)
    expect(resolveReadyQueueOptions(['--harness', 'claude-code'], {}).dryRun).toBe(false)
  })
})
