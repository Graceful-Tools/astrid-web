/**
 * AWTD-1119 (P6c): GitHub's sub-issues and issue dependencies become Astrid's
 * parentTaskId and TaskDependency rows (spec §8.4). Pure: GitHub's item shape
 * in, the relationship writes out.
 *
 * The rules pinned here:
 *   - only an issue has relationships; a draft, a PR and a redacted item have none;
 *   - a relationship is mirrored only when BOTH ends are mirrored tasks;
 *   - GitHub decides between two mirrored tasks; a parent or a blocker that is a
 *     local Astrid task is Astrid's own and is left alone;
 *   - a cycle arriving from GitHub is accepted (Astrid's 409 is for Astrid writes);
 *   - a truncated blocker list adds, and never removes.
 */

import { describe, it, expect } from 'vitest'
import { remoteRelations, planRelations, type ReplicaRelations } from '@/lib/github/projects/relations'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'

function issue(extra: Partial<NonNullable<RemoteProjectItem['content']>> = {}, item: Partial<RemoteProjectItem> = {}): RemoteProjectItem {
  return {
    id: 'PVTI_1',
    isArchived: false,
    type: 'ISSUE',
    updatedAt: '2026-10-10T00:00:00Z',
    content: { __typename: 'Issue', id: 'I_child', title: 't', body: null, updatedAt: '2026-10-10T00:00:00Z', ...extra },
    fieldValues: { nodes: [] },
    ...item,
  }
}

const TASKS: Record<string, string> = { I_child: 'task-child', I_parent: 'task-parent', I_a: 'task-a', I_b: 'task-b' }
const taskIdOf = (nodeId: string) => TASKS[nodeId]

const replica = (extra: Partial<ReplicaRelations> = {}): ReplicaRelations => ({
  taskId: 'task-child',
  parentTaskId: null,
  parentIsLocal: false,
  mirroredBlockerTaskIds: [],
  ...extra,
})

describe('remoteRelations (AWTD-1119)', () => {
  it('reads an issue’s parent and blockers by node id', () => {
    const item = issue({ parent: { id: 'I_parent' }, blockedBy: { totalCount: 2, nodes: [{ id: 'I_a' }, { id: 'I_b' }] } })
    expect(remoteRelations(item)).toEqual({ parentNodeId: 'I_parent', blockedByNodeIds: ['I_a', 'I_b'], blockersComplete: true })
  })

  it('an issue with neither has none, and its (empty) blocker list is complete', () => {
    expect(remoteRelations(issue({ parent: null, blockedBy: { totalCount: 0, nodes: [] } }))).toEqual({
      parentNodeId: null,
      blockedByNodeIds: [],
      blockersComplete: true,
    })
  })

  it('more blockers than the fragment read is an incomplete list', () => {
    const item = issue({ blockedBy: { totalCount: 31, nodes: [{ id: 'I_a' }] } })
    expect(remoteRelations(item)?.blockersComplete).toBe(false)
  })

  it('a draft, a pull request and a redacted item have no relationships to mirror', () => {
    expect(remoteRelations(issue({ __typename: 'DraftIssue' }, { type: 'DRAFT_ISSUE' }))).toBeNull()
    expect(remoteRelations(issue({ __typename: 'PullRequest' }, { type: 'PULL_REQUEST' }))).toBeNull()
    expect(remoteRelations(issue({}, { type: 'REDACTED', content: null }))).toBeNull()
  })

  it('an item hydrated before the fragment grew is unknown, not "no relationships"', () => {
    // No `blockedBy` key at all: nothing may be removed on its say-so.
    expect(remoteRelations(issue())).toEqual({ parentNodeId: null, blockedByNodeIds: [], blockersComplete: false })
  })
})

describe('planRelations (AWTD-1119)', () => {
  const remote = (parentNodeId: string | null, blockedByNodeIds: string[] = [], blockersComplete = true) => ({
    parentNodeId,
    blockedByNodeIds,
    blockersComplete,
  })

  it('a sub-issue takes its parent’s task as parentTaskId', () => {
    expect(planRelations(remote('I_parent'), replica(), taskIdOf)).toEqual({
      parentTaskId: 'task-parent',
      addBlockers: [],
      removeBlockers: [],
    })
  })

  it('already in step: nothing to write', () => {
    const plan = planRelations(remote('I_parent', ['I_a']), replica({ parentTaskId: 'task-parent', mirroredBlockerTaskIds: ['task-a'] }), taskIdOf)
    expect(plan).toEqual({ addBlockers: [], removeBlockers: [] })
  })

  it('removed from its parent on GitHub: the mirrored parent is cleared', () => {
    expect(planRelations(remote(null), replica({ parentTaskId: 'task-parent' }), taskIdOf)).toMatchObject({ parentTaskId: null })
  })

  it('a parent that is not mirrored cannot be pointed at, and clears a stale mirrored one', () => {
    expect(planRelations(remote('I_elsewhere'), replica(), taskIdOf)).toEqual({ addBlockers: [], removeBlockers: [] })
    expect(planRelations(remote('I_elsewhere'), replica({ parentTaskId: 'task-parent' }), taskIdOf)).toMatchObject({ parentTaskId: null })
  })

  it('a local Astrid parent is Astrid’s own: GitHub having none does not clear it', () => {
    const plan = planRelations(remote(null), replica({ parentTaskId: 'local-1', parentIsLocal: true }), taskIdOf)
    expect(plan).toEqual({ addBlockers: [], removeBlockers: [] })
  })

  it('but a GitHub parent replaces a local one', () => {
    const plan = planRelations(remote('I_parent'), replica({ parentTaskId: 'local-1', parentIsLocal: true }), taskIdOf)
    expect(plan.parentTaskId).toBe('task-parent')
  })

  it('blockers converge on GitHub: new ones added, ones gone from GitHub removed', () => {
    const plan = planRelations(remote(null, ['I_a']), replica({ mirroredBlockerTaskIds: ['task-b'] }), taskIdOf)
    expect(plan).toEqual({ addBlockers: ['task-a'], removeBlockers: ['task-b'] })
  })

  it('a blocker that is not mirrored is not a row', () => {
    expect(planRelations(remote(null, ['I_elsewhere', 'I_a']), replica(), taskIdOf).addBlockers).toEqual(['task-a'])
  })

  it('an incomplete blocker list adds and never removes', () => {
    const plan = planRelations(remote(null, ['I_a'], false), replica({ mirroredBlockerTaskIds: ['task-b'] }), taskIdOf)
    expect(plan).toEqual({ addBlockers: ['task-a'], removeBlockers: [] })
  })

  it('accepts a cycle from GitHub: A blocked by B is planned even though B is blocked by A', () => {
    // B (task-b) is already blocked by the child; GitHub now says the child is blocked by B too.
    const plan = planRelations(remote(null, ['I_b']), replica(), taskIdOf)
    expect(plan.addBlockers).toEqual(['task-b'])
  })

  it('never relates a task to itself', () => {
    const plan = planRelations(remote('I_child', ['I_child']), replica(), taskIdOf)
    expect(plan).toEqual({ addBlockers: [], removeBlockers: [] })
  })
})
