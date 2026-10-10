/**
 * AWTD-1149 (P4a): applying a GitHub ProjectV2Item to Astrid's replica is a
 * pure normalise → diff → plan (spec §8.7, §9.1–9.3, §13.2). No network, no
 * database: the fixtures are GitHub's GraphQL item shape, and the replica is a
 * plain Task subset.
 *
 * The rules pinned here:
 *   - the task is keyed by the CONTENT node id (stable across transfers), not
 *     by owner/repo#N;
 *   - Done, or a closed issue/PR, is completed; a done task carries no status
 *     role (the board's invariant); reopening clears completion;
 *   - apply compares VALUES, never timestamps — an echo is a no-op;
 *   - an archived item leaves the list; a redacted one is skipped;
 *   - no plan costs more than 4 queries (§13.3).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normaliseItem,
  diffTask,
  planItemApply,
  type BindingFieldMap,
  type RemoteProjectItem,
  type ReplicaTask,
} from '@/lib/github/projects/apply'

const DIR = join(process.cwd(), 'tests/fixtures/github/project-items')
const load = <T,>(name: string): T => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as T
const binding = load<BindingFieldMap>('binding.json')
const item = (name: string) => load<RemoteProjectItem>(`${name}.json`)

/** The replica as it would stand after applying `name` once. */
function replicaOf(name: string): ReplicaTask {
  const n = normaliseItem(item(name), binding)
  if (!n) throw new Error(`${name} normalises to nothing`)
  return { id: `task-${name}`, ...n.task, identifier: n.identifier, remoteKind: n.remoteKind, remoteVersion: n.remoteVersion }
}

describe('normaliseItem (AWTD-1149)', () => {
  it('an open issue in Todo: identity, content, status, priority, all-day due', () => {
    const n = normaliseItem(item('issue-open-todo'), binding)

    expect(n).toEqual({
      itemNodeId: 'PVTI_issue_open',
      archived: false,
      remoteNodeId: 'I_kwDOAcme001',
      remoteKind: 'issue',
      remoteVersion: '2026-10-10T08:59:00Z',
      identifier: 'Graceful-Fools/wordlesolver#42',
      url: 'https://github.com/Graceful-Fools/wordlesolver/issues/42',
      task: {
        title: 'Fix the login redirect',
        description: 'Steps to reproduce:\n1. Sign in\n2. Watch it loop',
        completed: false,
        closedReason: null,
        statusRole: 'ready',
        priority: 2,
        dueDateTime: new Date('2026-10-20T00:00:00.000Z'),
        isAllDay: true,
      },
    })
  })

  it('a closed-as-not-planned issue is completed with that reason, and holds no status role', () => {
    const n = normaliseItem(item('issue-closed-not-planned'), binding)!

    expect(n.task).toMatchObject({ completed: true, closedReason: 'not_planned', statusRole: null })
  })

  it('the Done option completes an issue GitHub has not closed yet', () => {
    expect(normaliseItem(item('issue-open-done-option'), binding)!.task).toMatchObject({
      completed: true,
      closedReason: null,
      statusRole: null,
    })
  })

  it('a draft has no identifier, and an option mapped to a custom state keeps that role', () => {
    const n = normaliseItem(item('draft-review'), binding)!

    expect(n).toMatchObject({ remoteKind: 'draft', identifier: null, url: null, remoteNodeId: 'DI_lADOAcme004' })
    expect(n.task).toMatchObject({ statusRole: 'gh:opt_review', priority: 3, dueDateTime: null, isAllDay: false })
  })

  it('a merged PR is completed; a PR closed unmerged is completed as canceled', () => {
    expect(normaliseItem(item('pull-request-merged'), binding)!.task).toMatchObject({ completed: true, closedReason: null })
    expect(normaliseItem(item('pull-request-closed-unmerged'), binding)!.task).toMatchObject({
      completed: true,
      closedReason: 'canceled',
    })
    expect(normaliseItem(item('pull-request-merged'), binding)!.remoteKind).toBe('pull_request')
  })

  it('a status option added after binding lands in Inbox rather than inventing a role', () => {
    expect(normaliseItem(item('issue-unmapped-status'), binding)!.task.statusRole).toBeNull()
  })

  it('no Priority or Status field bound: priority 0, Inbox', () => {
    const n = normaliseItem(item('issue-open-todo'), { ...binding, statusFieldId: null, priorityFieldId: null, dueFieldId: null })!

    expect(n.task).toMatchObject({ statusRole: null, priority: 0, dueDateTime: null, isAllDay: false })
  })

  it('a redacted item (no access to its content) normalises to nothing', () => {
    expect(normaliseItem(item('redacted'), binding)).toBeNull()
  })

  it('reports an archived item as archived', () => {
    expect(normaliseItem(item('issue-archived'), binding)!.archived).toBe(true)
  })
})

describe('diffTask compares values, never timestamps (AWTD-1149)', () => {
  it('an echo of the replica is empty', () => {
    const n = normaliseItem(item('issue-open-todo'), binding)!

    expect(diffTask(n, replicaOf('issue-open-todo'))).toEqual({ patch: {}, changed: [] })
  })

  it('only changed fields are patched, and a new version alone is bookkeeping, not a change', () => {
    const replica = { ...replicaOf('issue-open-todo'), title: 'Old title', remoteVersion: 'older' }
    const { patch, changed } = diffTask(normaliseItem(item('issue-open-todo'), binding)!, replica)

    expect(patch).toEqual({ title: 'Fix the login redirect', remoteVersion: '2026-10-10T08:59:00Z' })
    expect(changed).toEqual(['title'])
  })

  it('the same due day is no change, whatever the stored time-of-day encoding', () => {
    const replica = { ...replicaOf('issue-open-todo'), dueDateTime: new Date('2026-10-20T00:00:00.000Z') }

    expect(diffTask(normaliseItem(item('issue-open-todo'), binding)!, replica).changed).toEqual([])
  })

  it('a null description in the replica equals an empty body', () => {
    const replica = { ...replicaOf('issue-closed-not-planned'), description: null }

    expect(diffTask(normaliseItem(item('issue-closed-not-planned'), binding)!, replica).changed).toEqual([])
  })

  it('reopening on GitHub clears completion and restores the mapped lane', () => {
    const replica = { ...replicaOf('issue-open-todo'), completed: true, closedReason: 'not_planned', statusRole: null }
    const { patch } = diffTask(normaliseItem(item('issue-open-todo'), binding)!, replica)

    expect(patch).toMatchObject({ completed: false, closedReason: null, statusRole: 'ready' })
  })
})

describe('planItemApply (AWTD-1149)', () => {
  it('a new item creates the task and its membership: 2 queries', () => {
    const plan = planItemApply({ item: item('issue-open-todo'), binding, replica: null, membership: null })

    expect(plan).toMatchObject({ action: 'create', queries: 2 })
    expect(plan.action === 'create' && plan.data.remoteNodeId).toBe('I_kwDOAcme001')
  })

  it('an unchanged item with its membership is a no-op: 0 queries', () => {
    const plan = planItemApply({
      item: item('issue-open-todo'),
      binding,
      replica: replicaOf('issue-open-todo'),
      membership: { itemNodeId: 'PVTI_issue_open', archived: false },
    })

    expect(plan).toEqual({ action: 'noop', queries: 0 })
  })

  it('a changed item updates the task: 1 query, and says what changed for events/SSE', () => {
    const plan = planItemApply({
      item: item('issue-open-todo'),
      binding,
      replica: { ...replicaOf('issue-open-todo'), priority: 0 },
      membership: { itemNodeId: 'PVTI_issue_open', archived: false },
    })

    expect(plan).toMatchObject({ action: 'update', queries: 1, changed: ['priority'], patch: { priority: 2 } })
  })

  it('a task already in Astrid but new to this project gains the membership too', () => {
    const plan = planItemApply({
      item: item('issue-open-todo'),
      binding,
      replica: replicaOf('issue-open-todo'),
      membership: null,
    })

    expect(plan).toMatchObject({ action: 'update', addMembership: true, queries: 1 })
  })

  it('an archived item leaves the list (the task itself is kept)', () => {
    const plan = planItemApply({
      item: item('issue-archived'),
      binding,
      replica: replicaOf('issue-archived'),
      membership: { itemNodeId: 'PVTI_archived', archived: false },
    })

    expect(plan).toMatchObject({ action: 'leave', queries: 2 })
  })

  it('an archived item we never imported is ignored', () => {
    expect(planItemApply({ item: item('issue-archived'), binding, replica: null, membership: null })).toEqual({
      action: 'noop',
      queries: 0,
    })
  })

  it('a redacted item is skipped with a reason', () => {
    expect(planItemApply({ item: item('redacted'), binding, replica: null, membership: null })).toMatchObject({
      action: 'skip',
      reason: 'redacted',
      queries: 0,
    })
  })

  it('no plan for any fixture costs more than 4 queries (§13.3)', () => {
    for (const name of [
      'issue-open-todo', 'issue-closed-not-planned', 'issue-open-done-option', 'draft-review',
      'pull-request-merged', 'pull-request-closed-unmerged', 'issue-archived', 'redacted', 'issue-unmapped-status',
    ]) {
      for (const replica of [null, { id: 't', title: '', description: '', completed: false, closedReason: null, statusRole: null, priority: 0, dueDateTime: null, isAllDay: false, identifier: null, remoteKind: null, remoteVersion: null }]) {
        for (const membership of [null, { itemNodeId: 'x', archived: false }]) {
          expect(planItemApply({ item: item(name), binding, replica, membership }).queries).toBeLessThanOrEqual(4)
        }
      }
    }
  })
})
