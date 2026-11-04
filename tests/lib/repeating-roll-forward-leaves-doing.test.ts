/**
 * A finished recurring run must leave Doing (2026-11-04).
 *
 * Completing a repeating task rolls it forward: same row, next date, `completed: false`. The
 * lane was never touched, so an agent that claimed the weekly security audit (AWTD-914) —
 * moving it to Doing — and then completed it would leave next week's occurrence in Doing,
 * where the queue never looks and the stuck-Doing backstop calls it "ended before finishing".
 *
 * So for an AGENT's task, a roll-forward out of Doing lands in Ready, where the lane sweep
 * parks it in Waiting until its new date (Ready only queues tasks that are due). A person's
 * card is theirs to move and stays where it was — the same split as reopening
 * (resolveCompletionStatusTransition).
 */
import { describe, it, expect } from 'vitest'
import { resolveRollForwardStatusRole } from '@/lib/task-status'

describe('repeating roll-forward and the board lane', () => {
  it("moves an agent's occurrence out of Doing into Ready", () => {
    expect(resolveRollForwardStatusRole({ currentStatusRole: 'doing', assigneeIsAgent: true })).toBe('ready')
    expect(resolveRollForwardStatusRole({ currentStatusRole: ' Doing ', assigneeIsAgent: true })).toBe('ready')
  })

  it("leaves a person's card where it is", () => {
    expect(resolveRollForwardStatusRole({ currentStatusRole: 'doing', assigneeIsAgent: false })).toBeUndefined()
  })

  it('leaves every other lane alone — what already works keeps working', () => {
    for (const role of ['ready', 'waiting', 'review', null, undefined]) {
      expect(resolveRollForwardStatusRole({ currentStatusRole: role, assigneeIsAgent: true })).toBeUndefined()
    }
  })
})
