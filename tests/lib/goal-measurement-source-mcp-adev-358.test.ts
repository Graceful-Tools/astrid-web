/**
 * ADEV-358: a person can link a goal or guardrail to a measurement service over MCP. The tools
 * proxy the project goals API, which refuses agents, so nothing here widens who may change them.
 */
import { describe, expect, it, vi } from 'vitest'
import { callProjectGoalsTool, PROJECT_GOALS_TOOLS } from '@/mcp/project-goals-tool'
import { OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'

const stored = () => ({
  projectId: 'p1',
  goals: [{ id: 'g1', statement: 'Fast', history: [{ value: '300 ms', by: 'u', at: '2026-11-01T00:00:00.000Z' }], current: '300 ms' }],
  guardrails: [
    { id: 'r1', statement: 'Stay quick', kind: 'stated' },
    { id: 'r2', statement: 'Few errors', kind: 'enforced', check: { type: 'metric', source: { connectorId: 'c1', metricKey: 'errs' }, op: '<=', threshold: 1, current: 0.5, measuredAt: '2026-11-27T00:00:00.000Z' } },
  ],
})

function client() {
  const makeRequest = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? { ok: true } : stored()))
  return { makeRequest, put: () => JSON.parse(makeRequest.mock.calls.find(c => c[1]?.method === 'PUT')![1]!.body as string) }
}

describe('link_measurement_source and list_project_connectors (ADEV-358)', () => {
  it('registers both tools on the OAuth MCP server', () => {
    for (const name of ['list_project_connectors', 'link_measurement_source']) {
      expect(PROJECT_GOALS_TOOLS.some(t => t.name === name)).toBe(true)
      expect(OAUTH_MCP_TOOLS.some(t => t.name === name)).toBe(true)
    }
  })

  it('lists the connectors of the project a task is in', async () => {
    const makeRequest = vi.fn(async (url: string) =>
      url.startsWith('/api/v1/tasks/') ? { task: { listIds: ['l1'] } } : url.endsWith('/goals') ? { projectId: 'p1' } : { connectors: [] })
    await callProjectGoalsTool({ makeRequest } as never, 'list_project_connectors', { taskId: 'ADEV-1' })
    expect(makeRequest).toHaveBeenLastCalledWith('/api/v1/projects/p1/connectors')
  })

  it('binds a goal to a metric and keeps its history and current value', async () => {
    const c = client()
    await callProjectGoalsTool(c as never, 'link_measurement_source', { projectId: 'p1', goalId: 'g1', connectorId: 'c1', metricKey: 'p95', direction: 'down', unit: 'ms' })
    const sent = c.put()
    expect(sent.goals[0]).toMatchObject({
      id: 'g1',
      current: '300 ms',
      history: [{ value: '300 ms' }],
      metric: { direction: 'down', unit: 'ms', source: { connectorId: 'c1', metricKey: 'p95' } },
    })
    expect(sent.guardrails).toHaveLength(2)
  })

  it('needs a direction for a goal with no metric', async () => {
    await expect(
      callProjectGoalsTool(client() as never, 'link_measurement_source', { projectId: 'p1', goalId: 'g1', connectorId: 'c1', metricKey: 'p95' }),
    ).rejects.toThrow(/direction/)
  })

  it('turns a stated guardrail into an enforced metric check', async () => {
    const c = client()
    await callProjectGoalsTool(c as never, 'link_measurement_source', { projectId: 'p1', guardrailId: 'r1', connectorId: 'c1', metricKey: 'p95', op: '<=', threshold: 400 })
    expect(c.put().guardrails[0]).toEqual({
      id: 'r1',
      statement: 'Stay quick',
      kind: 'enforced',
      check: { type: 'metric', source: { connectorId: 'c1', metricKey: 'p95' }, op: '<=', threshold: 400 },
    })
  })

  it('keeps the reading only when the guardrail still points at the same metric', async () => {
    const same = client()
    await callProjectGoalsTool(same as never, 'link_measurement_source', { projectId: 'p1', guardrailId: 'r2', connectorId: 'c1', metricKey: 'errs', op: '<=', threshold: 2 })
    expect(same.put().guardrails[1].check).toMatchObject({ threshold: 2, current: 0.5 })
    const other = client()
    await callProjectGoalsTool(other as never, 'link_measurement_source', { projectId: 'p1', guardrailId: 'r2', connectorId: 'c2', metricKey: 'other', op: '>=', threshold: 2 })
    expect(other.put().guardrails[1].check).not.toHaveProperty('current')
  })

  it('refuses ambiguous or unknown targets before writing', async () => {
    const c = client()
    const link = (args: object) => callProjectGoalsTool(c as never, 'link_measurement_source', { projectId: 'p1', connectorId: 'c1', metricKey: 'm', ...args })
    await expect(link({})).rejects.toThrow(/goalId or guardrailId/)
    await expect(link({ goalId: 'g1', guardrailId: 'r1' })).rejects.toThrow(/not both/)
    await expect(link({ goalId: 'g9', direction: 'up' })).rejects.toThrow(/No goal g9/)
    await expect(link({ guardrailId: 'r1' })).rejects.toThrow(/op/)
    expect(c.makeRequest.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(false)
  })
})
