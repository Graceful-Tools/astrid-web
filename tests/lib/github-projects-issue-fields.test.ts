/**
 * AWTD-1313: a project field backed by a GitHub ISSUE field ("Target date",
 * "Start date" on Graceful-Fools project 2) cannot be written with
 * updateProjectV2ItemFieldValue. GitHub refuses it: "Issue field values cannot
 * be updated using the updateProjectV2ItemFieldValue mutation, they must be
 * updated using the updateIssueFieldValue mutation". The binding maps Target
 * date as the due field, so every due write through the mirror was refused.
 *
 * Pinned:
 *   - the schema read records which project field is backed by which issue
 *     field (`issueFieldId`), and reconcile notices when that changes;
 *   - on an ISSUE, a date/text/number issue field is written with
 *     updateIssueFieldValue against the ISSUE field's id, and cleared with
 *     `delete: true` — by write-through, create and the recurrence spawn;
 *   - a draft has no issue fields and keeps the project-field path;
 *   - an ordinary project field is unchanged;
 *   - a single-select issue field stays on the project path (its project
 *     options are not the issue field's, and GitHub lists none for it);
 *   - an issue field's value read through the item's fieldValues arrives as
 *     the ordinary value shape, so the due date is read back.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  planFieldValueMutation,
  planRemoteUpdate,
  type MutationPlan,
  type WritableMembership,
  type WritableTask,
} from '@/lib/github/projects/write'
import { planInitialFields, type CreatedContent } from '@/lib/github/projects/create'
import { planSpawnFields, type SpawnMembership } from '@/lib/github/projects/recur'
import { issueFieldsOf, normaliseFields, planFieldSchema, type RemoteField } from '@/lib/github/projects/fields'
import { PROJECT_ITEM_FRAGMENT, hydrateItem } from '@/lib/github/projects/hydrate'
import { PROJECT_SCHEMA_QUERY } from '@/lib/github/projects/bind'
import { normaliseItem, type BindingFieldMap, type RemoteProjectItem } from '@/lib/github/projects/apply'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

// Graceful-Fools project 2's real "Target date" and "Start date" project fields.
const TARGET = 'PVTF_lADOFEb-HM4BmXS2zhlAp8A'
const START = 'PVTF_lADOFEb-HM4BmXS2zhlAp78'
const ESTIMATE = 'PVTF_lADOFEb-HM4BmXS2zhlAp70'
const ISSUE_TARGET = 'IFD_target'
const ISSUE_START = 'IFD_start'

const binding: BindingFieldMap = {
  statusFieldId: 'F_status',
  statusOptionMap: { o_ready: 'ready', o_doing: 'doing', o_done: 'done' },
  priorityFieldId: null,
  priorityOptionMap: null,
  dueFieldId: TARGET,
}

const issue: WritableTask = {
  remoteNodeId: 'I_issue',
  remoteKind: 'issue',
  remoteVersion: '2026-10-28T00:00:00Z',
  title: 'Ship it',
  description: '',
  completed: false,
  closedReason: null,
  statusRole: 'ready',
  priority: 0,
  dueDateTime: null,
}
const draft: WritableTask = { ...issue, remoteNodeId: 'DI_draft', remoteKind: 'draft' }

const membership: WritableMembership = {
  projectNodeId: 'PVT_1',
  itemNodeId: 'PVTI_1',
  binding,
  issueFields: { [TARGET]: ISSUE_TARGET, [START]: ISSUE_START },
}

const mutations = (p: { document: string }) => [...p.document.matchAll(/m\d+: (\w+)\(/g)].map(m => m[1])

describe('write-through of the due date (AWTD-1313)', () => {
  it('AWTD-1313: setting the due date on an issue sends updateIssueFieldValue with the ISSUE field id', () => {
    const p = planRemoteUpdate(issue, [membership], { dueDateTime: new Date('2026-11-01T00:00:00Z') }) as MutationPlan
    expect(mutations(p)).toEqual(['updateIssueFieldValue'])
    expect(p.document).not.toContain('updateProjectV2ItemFieldValue')
    expect(p.variables).toEqual({
      m0_issueId: 'I_issue',
      m0_issueField: { fieldId: ISSUE_TARGET, dateValue: '2026-11-01' },
    })
    expect(p.document).toContain('$m0_issueField: IssueFieldCreateOrUpdateInput!')
  })

  it('AWTD-1313: clearing the due date on an issue deletes the issue field value', () => {
    const p = planRemoteUpdate({ ...issue, dueDateTime: new Date('2026-11-01T00:00:00Z') }, [membership], {
      dueDateTime: null,
    }) as MutationPlan
    expect(mutations(p)).toEqual(['updateIssueFieldValue'])
    expect(p.document).not.toContain('clearProjectV2ItemFieldValue')
    expect(p.variables.m0_issueField).toEqual({ fieldId: ISSUE_TARGET, delete: true })
  })

  it('AWTD-1313: the issue is written once even when it sits on two projects', () => {
    const second = { ...membership, projectNodeId: 'PVT_2', itemNodeId: 'PVTI_2' }
    const p = planRemoteUpdate(issue, [membership, second], { dueDateTime: new Date('2026-11-01T00:00:00Z') }) as MutationPlan
    expect(mutations(p)).toEqual(['updateIssueFieldValue'])
  })

  it('AWTD-1313: a draft has no issue fields and keeps the project-field path', () => {
    const p = planRemoteUpdate(draft, [membership], { dueDateTime: new Date('2026-11-01T00:00:00Z') }) as MutationPlan
    expect(mutations(p)).toEqual(['updateProjectV2ItemFieldValue'])
    expect(p.variables).toMatchObject({ m0_fieldId: TARGET, m0_value: { date: '2026-11-01' } })
  })

  it('AWTD-1313: an ordinary project field is written as before', () => {
    const plain = { ...membership, issueFields: {} }
    const p = planRemoteUpdate(issue, [plain], { dueDateTime: new Date('2026-11-01T00:00:00Z'), statusRole: 'doing' }) as MutationPlan
    expect(mutations(p)).toEqual(['updateProjectV2ItemFieldValue', 'updateProjectV2ItemFieldValue'])
  })

  it('AWTD-1313: Status beside an issue-field due date keeps its own path', () => {
    const p = planRemoteUpdate(issue, [membership], { dueDateTime: new Date('2026-11-01T00:00:00Z'), statusRole: 'doing' }) as MutationPlan
    expect(mutations(p)).toEqual(['updateProjectV2ItemFieldValue', 'updateIssueFieldValue'])
  })
})

describe('create and the fields route (AWTD-1313)', () => {
  const created: CreatedContent = {
    remoteNodeId: 'I_new',
    remoteKind: 'issue',
    remoteVersion: '2026-10-28T00:00:00Z',
    identifier: 'o/r#1',
    itemNodeId: 'PVTI_new',
  }

  it('AWTD-1313: a new issue gets its due date through updateIssueFieldValue', () => {
    const p = planInitialFields(created, membership, { title: 'x', dueDateTime: '2026-11-02T00:00:00Z' }) as MutationPlan
    expect(mutations(p)).toEqual(['updateIssueFieldValue'])
    expect(p.variables).toMatchObject({ m0_issueId: 'I_new', m0_issueField: { fieldId: ISSUE_TARGET, dateValue: '2026-11-02' } })
  })

  it('AWTD-1313: a new draft gets its due date on the project field', () => {
    const p = planInitialFields({ ...created, remoteNodeId: 'DI_new', remoteKind: 'draft' }, membership, {
      title: 'x',
      dueDateTime: '2026-11-02T00:00:00Z',
    }) as MutationPlan
    expect(mutations(p)).toEqual(['updateProjectV2ItemFieldValue'])
  })

  it('AWTD-1313: an unmapped issue field (Start date) written from the fields route', () => {
    const set = planFieldValueMutation(membership, START, { date: '2026-11-03' }, issue)
    expect(mutations(set)).toEqual(['updateIssueFieldValue'])
    expect(set.variables.m0_issueField).toEqual({ fieldId: ISSUE_START, dateValue: '2026-11-03' })
    const clear = planFieldValueMutation(membership, START, null, issue)
    expect(clear.variables.m0_issueField).toEqual({ fieldId: ISSUE_START, delete: true })
    // An ordinary field, and the same field on a draft, keep the project path.
    expect(mutations(planFieldValueMutation(membership, ESTIMATE, { number: 3 }, issue))).toEqual(['updateProjectV2ItemFieldValue'])
    expect(mutations(planFieldValueMutation(membership, START, { date: '2026-11-03' }, draft))).toEqual([
      'updateProjectV2ItemFieldValue',
    ])
  })

  it('AWTD-1313: text and number issue fields use textValue / numberValue', () => {
    const m = { ...membership, issueFields: { F_text: 'IFT_1', F_num: 'IFN_1' } }
    expect(planFieldValueMutation(m, 'F_text', { text: 'hi' }, issue).variables.m0_issueField).toEqual({ fieldId: 'IFT_1', textValue: 'hi' })
    expect(planFieldValueMutation(m, 'F_num', { number: 2 }, issue).variables.m0_issueField).toEqual({ fieldId: 'IFN_1', numberValue: 2 })
  })
})

describe('the recurrence spawn (AWTD-1313)', () => {
  const spawn = (over: Partial<SpawnMembership> = {}): SpawnMembership => ({
    projectNodeId: 'PVT_1',
    itemNodeId: 'PVTI_new',
    binding,
    issueFields: { [TARGET]: ISSUE_TARGET, [START]: ISSUE_START },
    fieldValues: [
      { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-10-05', field: { id: TARGET } },
      { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-10-01', field: { id: START } },
      { __typename: 'ProjectV2ItemFieldNumberValue', number: 5, field: { id: ESTIMATE } },
    ],
    ...over,
  })
  const successor = { remoteKind: 'issue' as const, remoteNodeId: 'I_next' }

  it('AWTD-1313: the next due date goes to the successor issue through updateIssueFieldValue', () => {
    const plan = planSpawnFields([spawn()], new Date('2026-10-12T00:00:00Z'), successor)
    const sent = Object.values(plan.variables)
    expect(sent).toContainEqual({ fieldId: ISSUE_TARGET, dateValue: '2026-10-12' })
    expect(sent).toContain('I_next')
    // The due field is never sent as a project-field value.
    expect(sent).not.toContain(TARGET)
    expect(plan.document).toContain('updateIssueFieldValue')
  })

  it('AWTD-1313: a copied issue field (Start date) also goes through updateIssueFieldValue; Estimate does not', () => {
    const plan = planSpawnFields([spawn()], new Date('2026-10-12T00:00:00Z'), successor)
    const sent = Object.values(plan.variables)
    expect(sent).toContainEqual({ fieldId: ISSUE_START, dateValue: '2026-10-01' })
    expect(sent).not.toContain(START)
    expect(sent).toContain(ESTIMATE)
    expect(sent).toContainEqual({ number: 5 })
  })

  it('AWTD-1313: no next date deletes the successor issue’s due value', () => {
    const plan = planSpawnFields([spawn()], null, successor)
    expect(Object.values(plan.variables)).toContainEqual({ fieldId: ISSUE_TARGET, delete: true })
    expect(plan.document).not.toContain('clearProjectV2ItemFieldValue')
  })

  it('AWTD-1313: a draft successor keeps the project-field path', () => {
    const plan = planSpawnFields([spawn()], new Date('2026-10-12T00:00:00Z'), { remoteKind: 'draft', remoteNodeId: 'DI_next' })
    expect(plan.document).not.toContain('updateIssueFieldValue')
    expect(Object.values(plan.variables)).toContain(TARGET)
  })
})

describe('recording which project field is an issue field (AWTD-1313)', () => {
  const remote: RemoteField[] = [
    { __typename: 'ProjectV2Field', id: TARGET, name: 'Target date', dataType: 'DATE', isIssueField: true, issueField: { id: ISSUE_TARGET } },
    { __typename: 'ProjectV2Field', id: ESTIMATE, name: 'Estimate', dataType: 'NUMBER', isIssueField: false, issueField: null },
  ]

  it('AWTD-1313: the schema query asks for the issue field behind each project field', () => {
    expect(PROJECT_SCHEMA_QUERY).toContain('isIssueField')
    expect(PROJECT_SCHEMA_QUERY).toContain('issueField {')
    expect(PROJECT_SCHEMA_QUERY).toContain('... on IssueFieldDate { id }')
  })

  it('AWTD-1313: normaliseFields keeps the issue field id; an ordinary field has none', () => {
    const [target, estimate] = normaliseFields(remote, binding)
    expect(target).toMatchObject({ remoteId: TARGET, mappedTo: 'due', issueFieldId: ISSUE_TARGET })
    expect(estimate.issueFieldId).toBeNull()
  })

  it('AWTD-1313: reconcile updates a held field whose issue field changed', () => {
    const fields = normaliseFields(remote, binding)
    const held = fields.map((f, i) => ({ ...f, id: `field-${i}`, issueFieldId: null }))
    expect(planFieldSchema(fields, held).update).toEqual([{ id: 'field-0', data: fields[0] }])
    const same = fields.map((f, i) => ({ ...f, id: `field-${i}` }))
    expect(planFieldSchema(fields, same).update).toEqual([])
  })

  it('AWTD-1313: the write map holds date/text/number issue fields, not single-selects', () => {
    expect(
      issueFieldsOf([
        { remoteId: TARGET, dataType: 'date', issueFieldId: ISSUE_TARGET },
        { remoteId: 'F_text', dataType: 'text', issueFieldId: 'IFT' },
        { remoteId: 'F_num', dataType: 'number', issueFieldId: 'IFN' },
        { remoteId: 'F_prio', dataType: 'single_select', issueFieldId: 'IFSS' },
        { remoteId: ESTIMATE, dataType: 'number', issueFieldId: null },
      ]),
    ).toEqual({ [TARGET]: ISSUE_TARGET, F_text: 'IFT', F_num: 'IFN' })
  })
})

describe('reading an issue field’s value back (AWTD-1313)', () => {
  it('AWTD-1313: the fragment reads ProjectV2ItemIssueFieldValue', () => {
    expect(PROJECT_ITEM_FRAGMENT).toContain('... on ProjectV2ItemIssueFieldValue')
  })

  it('AWTD-1313: an issue-field due date read through fieldValues becomes the task’s due date', async () => {
    const node = {
      id: 'PVTI_1',
      isArchived: false,
      type: 'ISSUE',
      updatedAt: '2026-10-28T00:00:00Z',
      content: { __typename: 'Issue', id: 'I_issue', title: 't', body: '', updatedAt: '2026-10-28T00:00:00Z', state: 'OPEN' },
      fieldValues: {
        nodes: [
          {
            __typename: 'ProjectV2ItemIssueFieldValue',
            field: { id: TARGET, dataType: 'DATE' },
            issueFieldValue: { __typename: 'IssueFieldDateValue', date: '2026-11-04' },
          },
        ],
      },
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { node } }), { status: 200 }))
    const client = createGraphqlClient({
      token: 'ghs_test',
      bucket: 'installation:1',
      priority: 'hydrate',
      budget: createBudget(memoryBudgetStore()),
      fetch: fetchImpl as unknown as typeof fetch,
    })
    const item = (await hydrateItem(client, 'PVTI_1')) as RemoteProjectItem
    expect(item.fieldValues.nodes[0]).toMatchObject({ __typename: 'ProjectV2ItemFieldDateValue', date: '2026-11-04', field: { id: TARGET } })
    expect(normaliseItem(item, binding)?.task.dueDateTime).toEqual(new Date('2026-11-04T00:00:00.000Z'))
  })
})
