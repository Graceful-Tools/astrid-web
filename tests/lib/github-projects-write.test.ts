/**
 * AWTD-1116 P5a: an Astrid edit as GitHub mutations (spec §8.7, §9.2).
 *
 * The plan is pure: what GitHub must be told, as ONE aliased document, or why
 * it can't be. Pinned:
 *   - only fields that CHANGE are sent (clients save the whole task);
 *   - title/body by content kind; Status by the bound option, per project;
 *   - completing moves to Done AND closes an issue; reopening reopens;
 *   - not-planned closes as NOT_PLANNED; a PR is never closed from here;
 *   - an unbound field or an unmapped role is refused, not dropped.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  changedMirroredFields,
  planRemoteUpdate,
  versionFromResult,
  type MutationPlan,
  type WritableMembership,
  type WritableTask,
} from '@/lib/github/projects/write'

const load = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/github/graphql', name), 'utf8'))

const issue: WritableTask = {
  remoteNodeId: 'I_kwDOVCns8c8AAAABWTcnYA',
  remoteKind: 'issue',
  remoteVersion: '2026-10-10T14:46:32Z',
  title: '[Astrid sync fixture] Open issue in Todo',
  description: 'body',
  completed: false,
  closedReason: null,
  statusRole: 'ready',
  priority: 0,
  dueDateTime: null,
}

const membership: WritableMembership = {
  projectNodeId: 'PVT_kwDOFEb-HM4BmXS2',
  itemNodeId: 'PVTI_lADOFEb-HM4BmXS2zg_2m1A',
  binding: {
    ...load('binding-graceful-fools.json'),
    priorityFieldId: 'PRI',
    priorityOptionMap: { p0: 3, p1: 2, p2: 1, p3: 0 },
    dueFieldId: 'DUE',
  },
}

const plan = (data: Record<string, unknown>, task = issue, memberships = [membership]) =>
  planRemoteUpdate(task, memberships, data) as MutationPlan

const mutations = (p: MutationPlan) => [...p.document.matchAll(/m\d+: (\w+)\(/g)].map(m => m[1])

describe('changedMirroredFields (AWTD-1116 P5a)', () => {
  it('a whole-task save with nothing changed changes nothing', () => {
    expect(
      changedMirroredFields(issue, {
        title: issue.title,
        description: issue.description,
        completed: false,
        statusRole: 'ready',
        priority: 0,
        dueDateTime: null,
        reminderTime: new Date(),
      }),
    ).toEqual({})
  })

  it('the same due day in another encoding is no change; null and empty body are the same', () => {
    const task = { ...issue, dueDateTime: new Date('2026-10-20T00:00:00.000Z'), description: null }
    expect(changedMirroredFields(task, { dueDateTime: '2026-10-20T15:00:00.000Z', description: '' })).toEqual({})
  })
})

describe('planRemoteUpdate (AWTD-1116 P5a)', () => {
  it('nothing mirrored changed → an empty plan', () => {
    expect(plan({ title: issue.title, reminderTime: new Date() })).toMatchObject({ document: '', versionAliases: [] })
  })

  it('title and body of an issue: one updateIssue carrying the new version', () => {
    const p = plan({ title: 'New', description: 'New body' })
    expect(mutations(p)).toEqual(['updateIssue'])
    expect(p.variables).toMatchObject({ m0_id: issue.remoteNodeId, m0_title: 'New', m0_body: 'New body' })
    expect(p).toMatchObject({ versionAliases: ['m0'], editsBody: true })
  })

  it('a draft is edited as a draft', () => {
    expect(mutations(plan({ title: 'x' }, { ...issue, remoteKind: 'draft', remoteNodeId: 'DI_1' }))).toEqual([
      'updateProjectV2DraftIssue',
    ])
  })

  it('AWTD-1119: a PR’s content is read-only — a title or body edit is refused, not sent', () => {
    const pr = { ...issue, remoteKind: 'pull_request' as const, remoteNodeId: 'PR_1' }
    expect(planRemoteUpdate(pr, [membership], { title: 'x' })).toEqual({ refused: 'pull_request_content' })
    expect(planRemoteUpdate(pr, [membership], { description: 'new body' })).toEqual({ refused: 'pull_request_content' })
  })

  it('AWTD-1119: a PR’s status stays editable, and an unchanged title riding along is not an edit', () => {
    const pr = { ...issue, remoteKind: 'pull_request' as const, remoteNodeId: 'PR_1' }
    expect(mutations(plan({ title: pr.title, statusRole: 'doing' }, pr))).toEqual(['updateProjectV2ItemFieldValue'])
  })

  it('a lane change sets the bound Status option; Inbox clears it', () => {
    const doing = plan({ statusRole: 'doing' })
    expect(mutations(doing)).toEqual(['updateProjectV2ItemFieldValue'])
    expect(doing.variables).toMatchObject({
      m0_projectId: 'PVT_kwDOFEb-HM4BmXS2',
      m0_itemId: 'PVTI_lADOFEb-HM4BmXS2zg_2m1A',
      m0_fieldId: 'PVTSSF_lADOFEb-HM4BmXS2zhlApMc',
      m0_value: { singleSelectOptionId: '47fc9ee4' },
    })
    expect(mutations(plan({ statusRole: null }))).toEqual(['clearProjectV2ItemFieldValue'])
  })

  it('completing moves the card to Done AND closes the issue (§8.7)', () => {
    const p = plan({ completed: true, statusRole: null })
    expect(mutations(p)).toEqual(['closeIssue', 'updateProjectV2ItemFieldValue'])
    expect(p.variables).toMatchObject({ m0_stateReason: 'COMPLETED', m1_value: { singleSelectOptionId: '98236657' } })
  })

  it('closing as not planned closes as NOT_PLANNED', () => {
    expect(plan({ completed: true, closedReason: 'not_planned' }).variables).toMatchObject({ m0_stateReason: 'NOT_PLANNED' })
  })

  it('reopening reopens the issue and restores the lane', () => {
    const p = plan({ completed: false, statusRole: 'doing' }, { ...issue, completed: true, statusRole: null })
    expect(mutations(p)).toEqual(['reopenIssue', 'updateProjectV2ItemFieldValue'])
  })

  it('a pull request is closed by merging on GitHub, never from here', () => {
    expect(planRemoteUpdate({ ...issue, remoteKind: 'pull_request' }, [membership], { completed: true })).toEqual({
      refused: 'pull_request_close',
    })
  })

  it('priority and due go to their bound fields; clearing clears', () => {
    const p = plan({ priority: 2, dueDateTime: new Date('2026-11-01T00:00:00Z') })
    expect(p.variables).toMatchObject({
      m0_fieldId: 'PRI',
      m0_value: { singleSelectOptionId: 'p1' },
      m1_fieldId: 'DUE',
      m1_value: { date: '2026-11-01' },
    })
    expect(mutations(plan({ dueDateTime: null }, { ...issue, dueDateTime: new Date('2026-11-01T00:00:00Z') }))).toEqual([
      'clearProjectV2ItemFieldValue',
    ])
  })

  it('a field the board does not bind is refused, not silently dropped', () => {
    const unbound = { ...membership, binding: { ...membership.binding, priorityFieldId: null, priorityOptionMap: null } }
    expect(planRemoteUpdate(issue, [unbound], { priority: 3 })).toEqual({ refused: 'field_not_bound', field: 'priority' })
  })

  it('a lane with no Status option on this project is refused', () => {
    expect(planRemoteUpdate(issue, [membership], { statusRole: 'custom-x' })).toEqual({
      refused: 'no_option_for_role',
      role: 'custom-x',
    })
  })

  it('a task on two projects sets Status on each', () => {
    const second = { ...membership, projectNodeId: 'PVT_2', itemNodeId: 'PVTI_2' }
    expect(mutations(plan({ statusRole: 'doing' }, issue, [membership, second]))).toEqual([
      'updateProjectV2ItemFieldValue',
      'updateProjectV2ItemFieldValue',
    ])
  })

  it('the document is valid GraphQL shape: one operation, typed variables', () => {
    const p = plan({ title: 'New', statusRole: 'doing' })
    expect(p.document).toMatch(/^mutation\(\$m0_id: ID!, \$m0_title: String, \$m1_projectId: ID!.*\) \{ m0: updateIssue/)
  })
})

describe('assignees and board moves (AWTD-1116 P5c)', () => {
  it('reassigning swaps the GitHub assignee: remove the old, add the new', () => {
    const p = planRemoteUpdate(issue, [membership], {}, { remove: [], add: [] }, { remove: ['U_old'], add: ['U_new'], set: ['U_new'] }) as MutationPlan
    expect(mutations(p)).toEqual(['removeAssigneesFromAssignable', 'addAssigneesToAssignable'])
    expect(p.variables).toMatchObject({ m0_assigneeIds: ['U_old'], m1_assigneeIds: ['U_new'] })
  })

  it('a draft sets its assignee list directly', () => {
    const draft = { ...issue, remoteKind: 'draft' as const, remoteNodeId: 'DI_1' }
    const p = planRemoteUpdate(draft, [membership], {}, { remove: [], add: [] }, { remove: [], add: ['U_new'], set: ['U_kept', 'U_new'] }) as MutationPlan
    expect(mutations(p)).toEqual(['updateProjectV2DraftIssue'])
    expect(p.variables).toMatchObject({ m0_assigneeIds: ['U_kept', 'U_new'] })
  })

  it('several assignees change by exactly the difference: one remove, one add (AWTD-1190)', () => {
    const change = { remove: ['U_a', 'U_b'], add: ['U_c', 'U_d'], set: ['U_keep', 'U_c', 'U_d'] }
    const p = planRemoteUpdate(issue, [membership], {}, { remove: [], add: [] }, change) as MutationPlan
    expect(mutations(p)).toEqual(['removeAssigneesFromAssignable', 'addAssigneesToAssignable'])
    expect(p.variables).toMatchObject({ m0_assigneeIds: ['U_a', 'U_b'], m1_assigneeIds: ['U_c', 'U_d'] })
  })

  it('adding someone removes nobody, and an empty difference sends nothing (AWTD-1190)', () => {
    const none = { remove: [], add: [] }
    const adding = planRemoteUpdate(issue, [membership], {}, none, { remove: [], add: ['U_c'], set: ['U_a', 'U_c'] }) as MutationPlan
    expect(mutations(adding)).toEqual(['addAssigneesToAssignable'])
    const same = planRemoteUpdate(issue, [membership], {}, none, { remove: [], add: [], set: ['U_a'] }) as MutationPlan
    expect(same.document).toBeFalsy()
  })

  it('leaving a board removes the item and no longer sets fields there', () => {
    const p = planRemoteUpdate(issue, [membership], { statusRole: 'doing' }, { remove: [membership], add: [] }) as MutationPlan
    expect(mutations(p)).toEqual(['deleteProjectV2Item'])
    expect(p.removedItems).toEqual([membership.itemNodeId])
  })

  it('joining a board adds the content and reports which alias carries the new item', () => {
    const p = planRemoteUpdate(issue, [membership], {}, { remove: [], add: ['PVT_2'] }) as MutationPlan
    expect(mutations(p)).toEqual(['addProjectV2ItemById'])
    expect(p.addedItems).toEqual({ m0: 'PVT_2' })
  })
})

describe('versionFromResult (AWTD-1116 P5a)', () => {
  it('reads the new version from a REAL recorded response', () => {
    expect(versionFromResult(load('write-issue-title-status.json').data, ['m0'])).toBe('2026-10-10T14:46:32Z')
  })

  it('takes the newest when several mutations report one', () => {
    expect(versionFromResult(load('write-close-reopen.json').data, ['m0', 'm1'])).toBe('2026-10-10T14:53:43Z')
  })
})
