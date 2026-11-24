/**
 * ADEV-255: the leading-control fixture carries `asksBeforeCompleting`, so astrid-core's
 * TaskRow.completionNeedsConfirmation reads web's answer instead of deriving it.
 * Rule: completed → false; no reader → true; otherwise assignee ≠ reader ('' is unassigned).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { completionNeedsConfirmation } from '@/lib/task-leading-control'

interface Case {
  assigneeId: string | null
  currentUserId: string | null
  completed: boolean
  asksBeforeCompleting?: boolean
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'contracts/fixtures/leading-control.json'), 'utf8'),
) as { cases: Case[] }

describe('ADEV-255 leading-control fixture: asksBeforeCompleting', () => {
  it('is present on every case', () => {
    expect(fixture.cases.length).toBeGreaterThan(0)
    for (const c of fixture.cases) expect(typeof c.asksBeforeCompleting).toBe('boolean')
  })

  it('matches completionNeedsConfirmation for every case', () => {
    for (const c of fixture.cases) {
      expect(c.asksBeforeCompleting).toBe(
        completionNeedsConfirmation({ assigneeId: c.assigneeId, currentUserId: c.currentUserId, completed: c.completed }),
      )
    }
  })

  it('follows the stated rule', () => {
    for (const c of fixture.cases) {
      const assignee = c.assigneeId || null
      const expected = c.completed ? false : c.currentUserId == null ? true : assignee !== c.currentUserId
      expect(c.asksBeforeCompleting).toBe(expected)
    }
  })
})
