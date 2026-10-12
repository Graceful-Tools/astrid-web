/**
 * The iOS UI-test account's fixtures (iOS task 44a9cea5).
 *
 * The seeder deletes every task on the account it is given. These pin the guard that keeps it
 * aimed at the throwaway one, and the fixture set that stops the suite skipping for lack of
 * anything to act on.
 */

import { describe, it, expect } from 'vitest'
import {
  UITEST_ACCOUNT_EMAIL,
  UITEST_FIXTURE_TASKS,
  assertUITestAccount,
  FIXTURE_RESET_TASK_QUERY,
  planFixtureReset,
} from '@/lib/uitest-fixtures'
import { BRAND } from '@/lib/brand/config'

describe('assertUITestAccount', () => {
  it('allows the dedicated test account', () => {
    expect(() => assertUITestAccount(UITEST_ACCOUNT_EMAIL)).not.toThrow()
  })

  // THE ONE THAT MATTERS. This function authorises deleting every task on an account.
  it('refuses a real account', () => {
    expect(() => assertUITestAccount('jonparis@gmail.com')).toThrow(/Refusing to seed/)
  })

  it('refuses a lookalike on the same domain', () => {
    expect(() => assertUITestAccount(`uitest2@${BRAND.domain}`)).toThrow()
    expect(() => assertUITestAccount(`uitest@${BRAND.domain}.evil.com`)).toThrow()
  })

  it('refuses a missing account rather than treating it as unset-and-fine', () => {
    expect(() => assertUITestAccount(null)).toThrow()
    expect(() => assertUITestAccount(undefined)).toThrow()
    expect(() => assertUITestAccount('')).toThrow()
  })

  it('names the account it refused, so the mistake is obvious in the output', () => {
    expect(() => assertUITestAccount('someone@example.com')).toThrow(/someone@example\.com/)
  })
})

describe('the fixture set', () => {
  // The suite taps "the first cell" and then completes / duplicates / opens it. With one task,
  // the second test in a file finds an empty list and skips — which is the bug, one step later.
  it('has enough open tasks for tests that consume one', () => {
    const open = UITEST_FIXTURE_TASKS.filter(t => !t.completed)
    expect(open.length).toBeGreaterThanOrEqual(3)
  })

  it('includes a completed task, so completion filters have both sides', () => {
    expect(UITEST_FIXTURE_TASKS.some(t => t.completed)).toBe(true)
  })

  it('varies priority, so a priority test has something to change from', () => {
    expect(new Set(UITEST_FIXTURE_TASKS.map(t => t.priority)).size).toBeGreaterThan(1)
  })

  // If one of these ever appears on a real board, the seeder was pointed somewhere it should
  // not have been — that has to be recognisable without checking ids.
  it('uses obviously synthetic titles', () => {
    for (const task of UITEST_FIXTURE_TASKS) expect(task.title).toMatch(/^UITEST /)
  })
})

describe('planFixtureReset', () => {
  it('removes everything that is there and recreates the fixtures', () => {
    const plan = planFixtureReset(['a', 'b', 'c'])
    expect(plan.delete).toEqual(['a', 'b', 'c'])
    expect(plan.create).toEqual(UITEST_FIXTURE_TASKS)
  })

  // A diff would keep whatever a half-finished run left behind, which is exactly the state
  // that makes the next failure unreproducible.
  it('is a reset, not a top-up — a matching title is still deleted first', () => {
    const plan = planFixtureReset(['existing-id'])
    expect(plan.delete).toContain('existing-id')
    expect(plan.create).toHaveLength(UITEST_FIXTURE_TASKS.length)
  })

  it('handles an already-empty account', () => {
    const plan = planFixtureReset([])
    expect(plan.delete).toEqual([])
    expect(plan.create).toEqual(UITEST_FIXTURE_TASKS)
  })

  it('does not hand back the caller’s array to mutate', () => {
    const existing = ['a']
    const plan = planFixtureReset(existing)
    plan.delete.push('b')
    expect(existing).toEqual(['a'])
  })
})

/**
 * Which tasks the reset SELECTS (AWTD-1235).
 *
 * `planFixtureReset` decides what to do with the ids it is handed; this decides
 * which ids it is handed, and that is where the bug was. The reset used to
 * inner-join through `_TaskToTaskList`, so it only saw tasks that were ON a
 * list — while the suite and the monkey quick-add from My Tasks, which creates
 * tasks on NO list. Those accumulated every run until the account's My Tasks
 * held 629 of them, pushing the three fixtures so far down a lazy list that
 * they never entered the accessibility tree. iOS CI then failed with "no
 * fixture task is visible", which reads like a missing fixture rather than a
 * reset quietly half-doing its job.
 *
 * Measured against production on 2026-10-12, read-only: the old query selected
 * **5** tasks, the new one selects **773** — 768 of them list-less tasks the
 * account created — and the new set is a strict superset of the old.
 */
describe('FIXTURE_RESET_TASK_QUERY (AWTD-1235)', () => {
  it('matches the account’s own tasks by creatorId, not only by list membership', () => {
    expect(FIXTURE_RESET_TASK_QUERY).toContain('t."creatorId" = $1')
    expect(FIXTURE_RESET_TASK_QUERY).toContain('l."ownerId" = $1')
    expect(FIXTURE_RESET_TASK_QUERY).toMatch(/l\."ownerId" = \$1 OR t\."creatorId" = \$1/)
  })

  it('NEVER matches on assigneeId', () => {
    // A task someone else created and assigned to the test account is not the
    // suite's to delete. Widening to assigneeId would make this reset destroy
    // another person's work because they shared it with a test account —
    // a far worse bug than the one it fixes.
    expect(FIXTURE_RESET_TASK_QUERY).not.toContain('assigneeId')
  })

  it('LEFT joins, so a list-less task is not dropped by the join itself', () => {
    // The whole defect in one word: an inner join cannot return a row with no
    // join partner, which is precisely the row being hunted.
    expect(FIXTURE_RESET_TASK_QUERY).not.toMatch(/\n\s+JOIN "_TaskToTaskList"/)
    expect(FIXTURE_RESET_TASK_QUERY).toContain('LEFT JOIN "_TaskToTaskList"')
    expect(FIXTURE_RESET_TASK_QUERY).toContain('LEFT JOIN "TaskList"')
  })

  it('is DISTINCT, so a task on two of the account’s lists is not deleted twice', () => {
    expect(FIXTURE_RESET_TASK_QUERY).toContain('SELECT DISTINCT')
  })

  it('takes the account as a bound parameter rather than interpolating it', () => {
    // This string is handed to $queryRawUnsafe. A literal id in it would be one
    // edit away from an injected one.
    expect(FIXTURE_RESET_TASK_QUERY).not.toMatch(/\$\{/)
  })
})
