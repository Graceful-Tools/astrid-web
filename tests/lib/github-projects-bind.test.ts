/**
 * AWTD-1151 (P4c): the bind wizard's proposal (spec §9.2) and the schema
 * reads behind it, from REAL recordings of the Graceful-Fools test org.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  proposeBinding,
  fetchProjectSchema,
  fetchOrgProjects,
  customRoleFor,
  type ProjectSchemaField,
} from '@/lib/github/projects/bind'
import { normaliseItem, type RemoteProjectItem } from '@/lib/github/projects/apply'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))

const clientReplaying = (body: unknown) =>
  createGraphqlClient({
    token: 't',
    bucket: 'installation:1',
    priority: 'write',
    budget: createBudget(memoryBudgetStore()),
    fetch: vi.fn(async () => new Response(JSON.stringify(body))) as never,
  })

const select = (id: string, name: string, options: string[]): ProjectSchemaField => ({
  __typename: 'ProjectV2SingleSelectField',
  id,
  name,
  dataType: 'SINGLE_SELECT',
  options: options.map((o, i) => ({ id: `${id}_${i}`, name: o })),
})

describe('proposeBinding (AWTD-1151)', () => {
  it('the real test project: Status by name, Target date, Estimate — and its option-less Priority left unbound', () => {
    const schema = load('project-schema.json').data.node
    const proposal = proposeBinding(schema)

    expect(proposal).toEqual({
      statusFieldId: 'PVTSSF_lADOFEb-HM4BmXS2zhlApMc',
      statusOptionMap: { f75ad846: 'ready', '47fc9ee4': 'doing', '98236657': 'done' },
      priorityFieldId: null,
      priorityOptionMap: null,
      dueFieldId: 'PVTF_lADOFEb-HM4BmXS2zhlAp8A',
      estimateFieldId: 'PVTF_lADOFEb-HM4BmXS2zhlAp70',
      customStates: [],
    })
  })

  it('and that proposal maps the recorded items exactly as the stored binding does', () => {
    const proposal = proposeBinding(load('project-schema.json').data.node)
    const items = load('project-items-page.json').data.node.items.nodes as RemoteProjectItem[]
    expect(items.map(i => normaliseItem(i, proposal)?.task.statusRole)).toEqual(['ready', null, 'doing'])
  })

  it('unknown Status options become custom columns, in GitHub’s order', () => {
    const proposal = proposeBinding({
      fields: { nodes: [select('S', 'Status', ['Backlog', 'QA', 'In Progress', 'Blocked', 'Ice box', 'Done'])] },
    })
    expect(proposal.statusOptionMap).toEqual({
      S_0: 'ready',
      S_1: customRoleFor('S_1'),
      S_2: 'doing',
      S_3: 'waiting',
      S_4: customRoleFor('S_4'),
      S_5: 'done',
    })
    expect(proposal.customStates).toEqual([
      { role: 'gh:S_1', name: 'QA', order: 0 },
      { role: 'gh:S_4', name: 'Ice box', order: 1 },
    ])
  })

  it('two options proposing one default: the first keeps it, the second gets its own column', () => {
    const proposal = proposeBinding({ fields: { nodes: [select('S', 'Status', ['Todo', 'Backlog'])] } })
    expect(proposal.statusOptionMap).toEqual({ S_0: 'ready', S_1: 'gh:S_1' })
  })

  it('Priority options in order map to 3, 2, 1, 0 — and anything past the fourth to 0', () => {
    const proposal = proposeBinding({ fields: { nodes: [select('P', 'Priority', ['P0', 'P1', 'P2', 'P3', 'P4'])] } })
    expect(proposal.priorityFieldId).toBe('P')
    expect(proposal.priorityOptionMap).toEqual({ P_0: 3, P_1: 2, P_2: 1, P_3: 0, P_4: 0 })
  })

  it('a due date field by name; an Estimate number field', () => {
    const proposal = proposeBinding({
      fields: {
        nodes: [
          { __typename: 'ProjectV2Field', id: 'D1', name: 'Start date', dataType: 'DATE' },
          { __typename: 'ProjectV2Field', id: 'D2', name: 'Target date', dataType: 'DATE' },
          { __typename: 'ProjectV2Field', id: 'E', name: 'Estimate', dataType: 'NUMBER' },
        ],
      },
    })
    expect(proposal).toMatchObject({ dueFieldId: 'D2', estimateFieldId: 'E', statusFieldId: null, statusOptionMap: {} })
  })
})

describe('schema reads (AWTD-1151)', () => {
  it('fetchProjectSchema returns the project with its owner', async () => {
    const schema = await fetchProjectSchema(clientReplaying(load('project-schema.json')), 'PVT_kwDOFEb-HM4BmXS2')
    expect(schema).toMatchObject({
      number: 2,
      title: 'Graceful-Tools Test',
      owner: { __typename: 'Organization', login: 'Graceful-Fools', databaseId: 340196892 },
    })
  })

  it('fetchProjectSchema is null for a project the installation cannot read', async () => {
    const body = { data: { node: null, rateLimit: { cost: 1, remaining: 1, resetAt: '2026-10-10T14:00:00Z' } } }
    expect(await fetchProjectSchema(clientReplaying(body), 'PVT_x')).toBeNull()
  })

  it('fetchOrgProjects lists the org’s projects', async () => {
    const projects = await fetchOrgProjects(clientReplaying(load('org-projects.json')), 'Graceful-Fools')
    expect(projects[0]).toMatchObject({ id: 'PVT_kwDOFEb-HM4BmXS2', title: 'Graceful-Tools Test', items: { totalCount: 3 } })
  })
})
