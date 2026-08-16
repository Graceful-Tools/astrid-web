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
  planFixtureReset,
} from '@/lib/uitest-fixtures'

describe('assertUITestAccount', () => {
  it('allows the dedicated test account', () => {
    expect(() => assertUITestAccount(UITEST_ACCOUNT_EMAIL)).not.toThrow()
  })

  // THE ONE THAT MATTERS. This function authorises deleting every task on an account.
  it('refuses a real account', () => {
    expect(() => assertUITestAccount('jonparis@gmail.com')).toThrow(/Refusing to seed/)
  })

  it('refuses a lookalike on the same domain', () => {
    expect(() => assertUITestAccount('uitest2@astrid.cc')).toThrow()
    expect(() => assertUITestAccount('uitest@astrid.cc.evil.com')).toThrow()
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
