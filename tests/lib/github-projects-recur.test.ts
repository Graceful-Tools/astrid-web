/**
 * AWTD-1118 (P6b): recurrence on a GitHub board SPAWNS the next issue instead
 * of rolling the same row forward (spec §10). Pure: the decision, the dedupe
 * key, the body footer, and the three mutation plans a spawn needs.
 *
 * Pinned:
 *   - a GitHub-backed list spawns; a personal list still rolls forward;
 *   - a cancelled or not-planned close ends the series, and so does a
 *     terminated one — neither spawns;
 *   - one dedupe key per occurrence, so an Astrid completion racing its
 *     webhook makes ONE issue;
 *   - the new issue copies title, body, labels, assignees and milestone, and
 *     its body gains `Previous occurrence: owner/repo#N`;
 *   - a draft spawns a draft;
 *   - every project field value is copied EXCEPT Status, which resets to the
 *     binding's first non-done option, and the due field, which is the next
 *     date;
 *   - a field type the mirror does not own is left alone rather than guessed.
 */

import { describe, it, expect } from 'vitest'
import {
  decideRecurrence,
  firstNonDoneOption,
  nextOccurrenceComment,
  planSpawnContent,
  parseSpawnSource,
  planSpawnFields,
  recurDedupeKey,
  spawnBody,
  type SpawnMembership,
} from '@/lib/github/projects/recur'
import type { BindingFieldMap, RemoteFieldValue } from '@/lib/github/projects/apply'

const binding = (over: Partial<BindingFieldMap> = {}): BindingFieldMap => ({
  statusFieldId: 'F_status',
  statusOptionMap: { o_ready: 'ready', o_doing: 'doing', o_done: 'done' },
  priorityFieldId: 'F_prio',
  priorityOptionMap: { p_low: 1, p_high: 3 },
  dueFieldId: 'F_due',
  ...over,
})

describe('the recurrence decision (AWTD-1118)', () => {
  const base = {
    repeatMode: 'spawn' as const,
    repeating: 'weekly',
    wasCompleted: false,
    isNowCompleted: true,
    closedReason: null as string | null,
    shouldTerminate: false,
  }

  it('spawns on a GitHub board and rolls forward on a personal list', () => {
    expect(decideRecurrence(base)).toBe('spawn')
    expect(decideRecurrence({ ...base, repeatMode: 'roll_forward' })).toBe('roll_forward')
  })

  it('does nothing when the task is not repeating', () => {
    expect(decideRecurrence({ ...base, repeating: 'never' })).toBe('none')
  })

  it('does nothing unless this update is the completion', () => {
    expect(decideRecurrence({ ...base, isNowCompleted: false })).toBe('none')
    // Already complete: re-saving a done task must not spawn a second issue.
    expect(decideRecurrence({ ...base, wasCompleted: true })).toBe('none')
  })

  it('ends the series on a close that is not "done"', () => {
    // "Not planned" ends the series (§10.1), as cancelling does locally.
    expect(decideRecurrence({ ...base, closedReason: 'not_planned' })).toBe('none')
    expect(decideRecurrence({ ...base, closedReason: 'canceled' })).toBe('none')
    expect(decideRecurrence({ ...base, closedReason: 'duplicate' })).toBe('none')
  })

  it('does not spawn past the end of the series', () => {
    expect(decideRecurrence({ ...base, shouldTerminate: true })).toBe('none')
  })
})

describe('the recur dedupe key (AWTD-1118)', () => {
  it('is one key per occurrence, so a completion and its webhook make one issue', () => {
    expect(recurDedupeKey('task-1', 0)).toBe('recur:task-1:0')
    expect(recurDedupeKey('task-1', 0)).toBe(recurDedupeKey('task-1', 0))
    expect(recurDedupeKey('task-1', 1)).not.toBe(recurDedupeKey('task-1', 0))
  })
})

describe('the link back to the predecessor (AWTD-1118)', () => {
  it('appends the previous occurrence to the body', () => {
    expect(spawnBody('Water the plants', 'acme/repo#12')).toBe(
      'Water the plants\n\nPrevious occurrence: acme/repo#12',
    )
  })

  it('still writes the footer when the predecessor had no body', () => {
    expect(spawnBody(null, 'acme/repo#12')).toBe('Previous occurrence: acme/repo#12')
    expect(spawnBody('', 'acme/repo#12')).toBe('Previous occurrence: acme/repo#12')
  })

  it('writes no footer for a draft, which has no identifier to point at', () => {
    expect(spawnBody('Water the plants', null)).toBe('Water the plants')
  })

  it('names the successor on the predecessor by its number', () => {
    expect(nextOccurrenceComment('acme/repo#13')).toBe('Next occurrence: #13')
    // A draft successor has no number; the comment is skipped rather than guessed.
    expect(nextOccurrenceComment(null)).toBeNull()
  })
})

describe('the spawned content (AWTD-1118)', () => {
  const predecessor = {
    remoteKind: 'issue' as const,
    identifier: 'acme/repo#12',
    title: 'Water the plants',
    body: 'Every Monday',
    repositoryNodeId: 'R_repo',
    labelIds: ['LA_1', 'LA_2'],
    assigneeIds: ['U_1'],
    milestoneId: 'MI_1',
  }

  it('creates an issue in the same repo, copying labels, assignees and milestone', () => {
    const plan = planSpawnContent(predecessor, { projectNodeId: 'PVT_1' })
    expect(plan.document).toContain('createIssue')
    expect(plan.variables).toMatchObject({
      r: 'R_repo',
      t: 'Water the plants',
      b: 'Every Monday\n\nPrevious occurrence: acme/repo#12',
      l: ['LA_1', 'LA_2'],
      a: ['U_1'],
      ms: 'MI_1',
    })
  })

  it('omits the optional copies the predecessor does not have', () => {
    const plan = planSpawnContent(
      { ...predecessor, labelIds: [], assigneeIds: [], milestoneId: null },
      { projectNodeId: 'PVT_1' },
    )
    expect(plan.variables.l).toBeUndefined()
    expect(plan.variables.a).toBeUndefined()
    expect(plan.variables.ms).toBeUndefined()
  })

  it('spawns a draft for a draft, in the same project', () => {
    const plan = planSpawnContent(
      { ...predecessor, remoteKind: 'draft', identifier: null, repositoryNodeId: null },
      { projectNodeId: 'PVT_1' },
    )
    expect(plan.document).toContain('addProjectV2DraftIssue')
    expect(plan.variables).toMatchObject({ p: 'PVT_1', t: 'Water the plants', b: 'Every Monday' })
  })
})

describe('the spawned card’s field values (AWTD-1118)', () => {
  const values = (): RemoteFieldValue[] => [
    { __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: 'o_done', field: { id: 'F_status' } },
    { __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: 'p_high', field: { id: 'F_prio' } },
    { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-10-05', field: { id: 'F_due' } },
    { __typename: 'ProjectV2ItemFieldTextValue', text: 'from the predecessor', field: { id: 'F_notes' } },
    { __typename: 'ProjectV2ItemFieldNumberValue', number: 5, field: { id: 'F_points' } },
  ]

  const membership = (over: Partial<SpawnMembership> = {}): SpawnMembership => ({
    projectNodeId: 'PVT_1',
    itemNodeId: 'PVTI_new',
    binding: binding(),
    fieldValues: values(),
    ...over,
  })

  it('resets Status to the first non-done option and sets the due field to the next date', () => {
    const plan = planSpawnFields([membership()], new Date('2026-10-12T00:00:00Z'))
    const sent = Object.values(plan.variables)
    expect(sent).toContainEqual({ singleSelectOptionId: 'o_ready' })
    expect(sent).toContainEqual({ date: '2026-10-12' })
    // The predecessor's Done option and its old date are not copied over.
    expect(sent).not.toContainEqual({ singleSelectOptionId: 'o_done' })
    expect(sent).not.toContainEqual({ date: '2026-10-05' })
  })

  it('copies every other field value as it stands', () => {
    const plan = planSpawnFields([membership()], new Date('2026-10-12T00:00:00Z'))
    const sent = Object.values(plan.variables)
    expect(sent).toContainEqual({ singleSelectOptionId: 'p_high' })
    expect(sent).toContainEqual({ text: 'from the predecessor' })
    expect(sent).toContainEqual({ number: 5 })
  })

  it('leaves a field type the mirror does not own alone', () => {
    // Nothing bound, so the iteration value is the only thing that could be
    // written — and an iteration is not ours to copy.
    const plan = planSpawnFields(
      [
        membership({
          binding: binding({ statusFieldId: null, statusOptionMap: {}, dueFieldId: null }),
          fieldValues: [{ __typename: 'ProjectV2ItemFieldIterationValue', field: { id: 'F_iter' } }],
        }),
      ],
      null,
    )
    expect(plan.document).toBe('')
  })

  it('does not copy an iteration alongside the values it does own', () => {
    const plan = planSpawnFields(
      [membership({ fieldValues: [...values(), { __typename: 'ProjectV2ItemFieldIterationValue', field: { id: 'F_iter' } }] })],
      new Date('2026-10-12T00:00:00Z'),
    )
    expect(Object.values(plan.variables)).not.toContain('F_iter')
  })

  it('clears the due field when the series has no next date', () => {
    const plan = planSpawnFields([membership()], null)
    expect(plan.document).toContain('clearProjectV2ItemFieldValue')
  })

  it('writes to every project the predecessor was in', () => {
    const plan = planSpawnFields(
      [membership(), membership({ projectNodeId: 'PVT_2', itemNodeId: 'PVTI_new_2' })],
      new Date('2026-10-12T00:00:00Z'),
    )
    expect(Object.values(plan.variables)).toContain('PVT_1')
    expect(Object.values(plan.variables)).toContain('PVT_2')
    expect(Object.values(plan.variables)).toContain('PVTI_new')
    expect(Object.values(plan.variables)).toContain('PVTI_new_2')
  })

  it('does not reset a Status field the board never bound', () => {
    const plan = planSpawnFields(
      [membership({ binding: binding({ statusFieldId: null, statusOptionMap: {} }) })],
      new Date('2026-10-12T00:00:00Z'),
    )
    expect(Object.values(plan.variables)).not.toContainEqual({ singleSelectOptionId: 'o_ready' })
  })
})

describe('the first non-done status option (AWTD-1118)', () => {
  it('is the first option in the board’s own order that is not done', () => {
    expect(firstNonDoneOption({ o_done: 'done', o_ready: 'ready', o_doing: 'doing' })).toBe('o_ready')
  })

  it('is the ready option whatever order the map comes back in (AWTD-1284)', () => {
    // The map is a jsonb column, and jsonb sorts its keys. Live on the
    // lanes-test preview it came back as { 47fc9ee4: doing, 98236657: done,
    // f75ad846: ready }, and the spawned card started in "In progress".
    expect(firstNonDoneOption({ '47fc9ee4': 'doing', '98236657': 'done', f75ad846: 'ready' })).toBe('f75ad846')
  })

  it('falls back to any non-done option on a board with no ready one', () => {
    expect(firstNonDoneOption({ o_done: 'done', o_doing: 'doing' })).toBe('o_doing')
  })

  it('is null on a board whose every option is done', () => {
    expect(firstNonDoneOption({ o_done: 'done' })).toBeNull()
    expect(firstNonDoneOption({})).toBeNull()
  })
})

describe('reading the predecessor off GitHub (AWTD-1118)', () => {
  const issue = {
    node: {
      __typename: 'Issue',
      id: 'I_1',
      title: 'Water the plants',
      body: 'Every Monday',
      number: 12,
      repository: { id: 'R_repo', nameWithOwner: 'acme/repo' },
      milestone: { id: 'MI_1' },
      labels: { nodes: [{ id: 'LA_1' }, { id: 'LA_2' }] },
      assignees: { nodes: [{ id: 'U_1' }] },
    },
  }

  it('reads the repo, milestone, labels and assignees a spawn copies', () => {
    expect(parseSpawnSource(issue)).toEqual({
      remoteKind: 'issue',
      identifier: 'acme/repo#12',
      title: 'Water the plants',
      body: 'Every Monday',
      repositoryNodeId: 'R_repo',
      labelIds: ['LA_1', 'LA_2'],
      assigneeIds: ['U_1'],
      milestoneId: 'MI_1',
    })
  })

  it('reads a draft as a draft, with nothing a draft cannot have', () => {
    const draft = parseSpawnSource({
      node: { __typename: 'DraftIssue', id: 'DI_1', title: 'Water', body: null, assignees: { nodes: [{ id: 'U_1' }] } },
    })
    expect(draft).toMatchObject({ remoteKind: 'draft', identifier: null, repositoryNodeId: null, labelIds: [], milestoneId: null })
  })

  it('is null when GitHub no longer has the content', () => {
    expect(parseSpawnSource({ node: null })).toBeNull()
    expect(parseSpawnSource({})).toBeNull()
  })

  it('is null for a pull request, which is never a recurring task', () => {
    expect(parseSpawnSource({ node: { __typename: 'PullRequest', id: 'PR_1', title: 'x' } })).toBeNull()
  })
})
