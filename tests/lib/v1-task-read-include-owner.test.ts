/**
 * AWTD-1039 check 5 — the v1 task shape must say who owns each list.
 *
 * Live task events now carry `v1Task`, and the web board merges it. Its lists
 * had no `ownerId`, so after a merge an owner who is not also a listMembers row
 * resolved to no role and the open pane went read-only: no board-state chips,
 * no "Wait on a task…", no way to remove a blocker. The event include at
 * v1-task-shape.ts already carries ownerId for exactly this reason (5208e723);
 * the read include, which events use, did not.
 */
import { describe, it, expect } from 'vitest'
import { V1_TASK_READ_INCLUDE } from '@/lib/tasks/v1-task-shape'

describe('AWTD-1039: V1_TASK_READ_INCLUDE lists carry ownerId', () => {
  it('AWTD-1039: selects ownerId, which permission checks resolve OWNER from', () => {
    expect(V1_TASK_READ_INCLUDE.lists.select).toHaveProperty('ownerId', true)
  })
})
