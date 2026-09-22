/**
 * Reopening a task gives it back to the agent (AWTD-964).
 *
 * Completing a task writes `{ statusRole: null, completed: true }`, and nothing
 * ever put a status back. So a task reopened from the phone landed at
 * `statusRole: null` — Inbox — which `isQueueableStatusRole` holds out of the
 * default queue. docs/FIXALL_WORKFLOW.md says "a REOPENED task looks exactly
 * like one never done"; that was true of the document and false of the queue,
 * and Jon had to set Ready by hand or the reopen was a no-op nothing saw.
 *
 * WHY THE STATUS IS REMEMBERED RATHER THAN RETAINED. The cheap fix is to stop
 * nulling `statusRole` on completion — the board would still render the task in
 * Done, because `taskColumnId` checks `completed` first. But a done task
 * carrying a board status violates an invariant the board depends on (task
 * db7c6670), enforced in two places in services/task.service.ts including a
 * list detach. So completion stashes the old lane and clears the live one, and
 * reopening moves it back.
 *
 * This is a pure rule with no database in it precisely so it can be pinned
 * here. Inline in the service it would be reachable only through a live
 * Postgres, which is why nothing caught the missing half in the first place.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveCompletionStatusTransition,
  READY_STATUS_ROLE,
  DOING_STATUS_ROLE,
  WAITING_STATUS_ROLE,
} from '@/lib/task-status'
import { isQueueableStatusRole } from '@/lib/ready-queue-scope'

describe('resolveCompletionStatusTransition — completing (AWTD-964)', () => {
  it('stashes the lane the task was in and clears the live one', () => {
    expect(
      resolveCompletionStatusTransition({
        requestedCompleted: true,
        currentStatusRole: DOING_STATUS_ROLE,
        rememberedStatusRole: null,
        assigneeIsAgent: true,
      }),
    ).toEqual({ statusRole: null, statusRoleBeforeDone: DOING_STATUS_ROLE })
  })

  it('keeps the done-carries-no-status invariant for every lane', () => {
    for (const role of [READY_STATUS_ROLE, DOING_STATUS_ROLE, WAITING_STATUS_ROLE, 'in-review']) {
      const transition = resolveCompletionStatusTransition({
        requestedCompleted: true,
        currentStatusRole: role,
        rememberedStatusRole: null,
        assigneeIsAgent: false,
      })
      expect(transition.statusRole).toBeNull()
    }
  })

  it('stashes null for a task completed straight out of Inbox', () => {
    expect(
      resolveCompletionStatusTransition({
        requestedCompleted: true,
        currentStatusRole: null,
        rememberedStatusRole: null,
        assigneeIsAgent: true,
      }),
    ).toEqual({ statusRole: null, statusRoleBeforeDone: null })
  })

  it('does not clobber the stashed lane when an already-completed task is completed again (AWTD-985)', () => {
    // Completion clears the live lane, so a second completed=true (idempotent
    // retry, sync backdating completedAt, double PUT) sees currentStatusRole
    // null. Writing that null into the stash would destroy the lane the
    // reopen needs — the remembered lane must survive.
    expect(
      resolveCompletionStatusTransition({
        requestedCompleted: true,
        currentStatusRole: null,
        rememberedStatusRole: DOING_STATUS_ROLE,
        assigneeIsAgent: true,
        currentCompleted: true,
      }),
    ).toEqual({ statusRole: null, statusRoleBeforeDone: DOING_STATUS_ROLE })
  })

  it('resets a stale stash when an OPEN task is completed from no lane (AWTD-985)', () => {
    // A reopen that bypasses resolveCompletionFields (GitHub Issues sync,
    // a repeating roll-forward) leaves the stash behind. If the user then
    // parks the task in Inbox and completes it, the next reopen must not
    // drop it back into the lane they moved it out of.
    expect(
      resolveCompletionStatusTransition({
        requestedCompleted: true,
        currentStatusRole: null,
        rememberedStatusRole: DOING_STATUS_ROLE,
        assigneeIsAgent: true,
        currentCompleted: false,
      }),
    ).toEqual({ statusRole: null, statusRoleBeforeDone: null })
  })
})

describe('resolveCompletionStatusTransition — reopening (AWTD-964)', () => {
  it('puts the task back in the lane it was completed from', () => {
    expect(
      resolveCompletionStatusTransition({
        requestedCompleted: false,
        currentStatusRole: null,
        rememberedStatusRole: WAITING_STATUS_ROLE,
        assigneeIsAgent: true,
      }),
    ).toEqual({ statusRole: WAITING_STATUS_ROLE, statusRoleBeforeDone: null })
  })

  it('clears the stash, so a second completion cannot restore a stale lane', () => {
    const transition = resolveCompletionStatusTransition({
      requestedCompleted: false,
      currentStatusRole: null,
      rememberedStatusRole: DOING_STATUS_ROLE,
      assigneeIsAgent: true,
    })
    expect(transition.statusRoleBeforeDone).toBeNull()
  })

  it("lands an agent's task in Ready when nothing was remembered", () => {
    // Every task completed before this shipped has an empty stash, and so does
    // one completed out of Inbox. Reopening one and handing it to an agent
    // means "do this again" — Ready is what that is.
    const transition = resolveCompletionStatusTransition({
      requestedCompleted: false,
      currentStatusRole: null,
      rememberedStatusRole: null,
      assigneeIsAgent: true,
    })

    expect(transition.statusRole).toBe(READY_STATUS_ROLE)
    // The whole point: this is the value get_agent_queue's WHERE requires.
    expect(isQueueableStatusRole(transition.statusRole, true)).toBe(true)
  })

  it("leaves a person's task in Inbox when nothing was remembered", () => {
    // A person reopening their own task has a board to look at. Promoting it
    // into Ready on their behalf would move cards they did not move.
    expect(
      resolveCompletionStatusTransition({
        requestedCompleted: false,
        currentStatusRole: null,
        rememberedStatusRole: null,
        assigneeIsAgent: false,
      }).statusRole,
    ).toBeNull()
  })

  it('prefers the remembered lane over the agent default — Waiting stays Waiting', () => {
    // A task parked on a named condition and then completed must not come back
    // as actionable. Waiting is the brake the scheduled loop depends on.
    const transition = resolveCompletionStatusTransition({
      requestedCompleted: false,
      currentStatusRole: null,
      rememberedStatusRole: WAITING_STATUS_ROLE,
      assigneeIsAgent: true,
    })

    expect(transition.statusRole).toBe(WAITING_STATUS_ROLE)
    expect(isQueueableStatusRole(transition.statusRole, true)).toBe(false)
  })
})

describe('resolveCompletionStatusTransition — neither (AWTD-964)', () => {
  it('changes nothing when the request says nothing about completion', () => {
    // Renaming a task must not move it between lanes.
    expect(
      resolveCompletionStatusTransition({
        requestedCompleted: undefined,
        currentStatusRole: DOING_STATUS_ROLE,
        rememberedStatusRole: READY_STATUS_ROLE,
        assigneeIsAgent: true,
      }),
    ).toEqual({})
  })
})
