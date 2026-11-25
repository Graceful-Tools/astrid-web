/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-276 (Goal signals 1d): goal chips link and unlink on tasks and lists, the goals strip shows
 * source, freshness and a sparkline, and the editor edits the metric block. A project that states
 * nothing draws nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() }))
vi.mock('@/lib/api', () => api)

import { GoalChips } from '@/components/projects/GoalChips'
import { ProjectGoalsStrip } from '@/components/projects/ProjectGoalsStrip'
import { ProjectGoalsEditor } from '@/components/projects/ProjectGoalsEditor'
import { __clearProjectGoalsCache } from '@/hooks/use-project-goals'
import { goalFreshness, goalSparkValues } from '@/lib/goals-guardrails'

const HOUR = 3_600_000
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString()

const GOALS = {
  goals: [
    { id: 'g1', statement: 'Faster pages' },
    { id: 'g2', statement: 'Fewer bugs' },
  ],
  guardrails: [],
}

function respond(goals: unknown, links: unknown[] = []) {
  api.apiGet.mockImplementation(async (url: string) => ({
    json: async () => (url.endsWith('/goals') && url.includes('/projects/') ? { projectId: 'p1', ...(goals as object), canEdit: true } : { links }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  __clearProjectGoalsCache()
})

describe('goalFreshness and goalSparkValues (ADEV-276)', () => {
  it('reads fresh within 48h by default and stale after', () => {
    expect(goalFreshness({ metric: { direction: 'up', measuredAt: iso(3) } })?.stale).toBe(false)
    expect(goalFreshness({ metric: { direction: 'up', measuredAt: iso(49) } })?.stale).toBe(true)
  })

  it('honours staleAfterHours and falls back to the latest history entry', () => {
    expect(goalFreshness({ metric: { direction: 'up', measuredAt: iso(5), staleAfterHours: 4 } })?.stale).toBe(true)
    expect(goalFreshness({ history: [{ value: '1', by: 'u', at: iso(1) }] })?.stale).toBe(false)
    expect(goalFreshness({})).toBeNull()
  })

  it('takes only numeric readings for the sparkline', () => {
    expect(
      goalSparkValues({ history: [{ value: 'a', by: 'u', at: iso(3), num: 1 }, { value: 'b', by: 'u', at: iso(2) }, { value: '3', by: 'u', at: iso(1), num: 3 }] }),
    ).toEqual([1, 3])
  })
})

describe('GoalChips (ADEV-276)', () => {
  it('draws nothing when the project states no goals', async () => {
    respond({ goals: [], guardrails: [] })
    const { container } = render(<GoalChips kind="task" id="t1" projectId="p1" canEdit />)
    await waitFor(() => expect(api.apiGet).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.querySelector('[data-testid="goal-chips"]')).toBeNull()
  })

  it('shows own and inherited chips, and links a goal with the project id', async () => {
    respond(GOALS, [
      { projectId: 'p1', goalId: 'g1', via: 'task' },
      { projectId: 'p1', goalId: 'g2', via: 'list', listId: 'l1' },
    ])
    render(<GoalChips kind="task" id="t1" projectId="p1" canEdit />)
    expect(await screen.findByText('Faster pages')).toBeTruthy()
    expect(screen.getByTestId('goal-chip-inherited').textContent).toBe('Fewer bugs')
    expect(screen.queryByTestId('goal-chip-add')).toBeNull() // every goal is already served
  })

  it('unlinks an own chip with DELETE', async () => {
    respond(GOALS, [{ projectId: 'p1', goalId: 'g1', via: 'task' }])
    api.apiDelete.mockResolvedValue({ json: async () => ({}) })
    render(<GoalChips kind="task" id="t1" projectId="p1" canEdit />)
    fireEvent.click(await screen.findByTestId('goal-chip-unlink'))
    await waitFor(() => expect(screen.queryByTestId('goal-chip')).toBeNull())
    const [url, options] = api.apiDelete.mock.calls[0]
    expect(url).toBe('/api/v1/tasks/t1/goals')
    expect(JSON.parse(options.body)).toEqual({ goalId: 'g1', projectId: 'p1' })
  })

  it('offers no unlink to someone who cannot edit', async () => {
    respond(GOALS, [{ projectId: 'p1', goalId: 'g1', via: 'task' }])
    render(<GoalChips kind="task" id="t1" projectId="p1" canEdit={false} />)
    await screen.findByText('Faster pages')
    expect(screen.queryByTestId('goal-chip-unlink')).toBeNull()
    expect(screen.queryByTestId('goal-chip-add')).toBeNull()
  })

  it('reads a list from its goal-links route', async () => {
    respond(GOALS, [{ projectId: 'p1', goalId: 'g2', via: 'list', listId: 'l1' }])
    render(<GoalChips kind="list" id="l1" projectId="p1" canEdit />)
    expect(await screen.findByTestId('goal-chip')).toBeTruthy()
    expect(api.apiGet).toHaveBeenCalledWith('/api/v1/lists/l1/goal-links')
  })
})

describe('ProjectGoalsStrip signals (ADEV-276)', () => {
  const open = async (goal: object) => {
    respond({ goals: [{ id: 'g1', statement: 'Faster pages', ...goal }], guardrails: [] })
    render(<ProjectGoalsStrip projectId="p1" />)
    fireEvent.click(await screen.findByTestId('project-goals-toggle'))
  }

  it('shows source, "updated … ago" and a sparkline', async () => {
    await open({
      metric: { direction: 'down', source: { connectorId: 'sentry', metricKey: 'p95' }, measuredAt: iso(3), current: 2 },
      history: [{ value: '5', by: 'u', at: iso(9), num: 5 }, { value: '2', by: 'u', at: iso(3), num: 2 }],
    })
    expect(screen.getByTestId('project-goal-source').textContent).toContain('sentry · p95')
    expect(screen.getByTestId('project-goal-freshness').dataset.stale).toBe('false')
    expect(screen.getByTestId('project-goal-sparkline')).toBeTruthy()
  })

  it('marks an old reading stale', async () => {
    await open({ metric: { direction: 'up', measuredAt: iso(100), current: 2 } })
    expect(screen.getByTestId('project-goal-freshness').dataset.stale).toBe('true')
  })

  it('draws no signal for a prose goal', async () => {
    await open({})
    expect(screen.queryByTestId('project-goal-signal')).toBeNull()
  })
})

describe('ProjectGoalsEditor metric block (ADEV-276)', () => {
  it('adds, edits and clears the metric, keeping server-written keys', () => {
    const onChange = vi.fn()
    const metric = { direction: 'up' as const, current: 7, measuredAt: iso(1), source: { connectorId: 'c', metricKey: 'k' } }
    const { rerender } = render(
      <ProjectGoalsEditor value={{ goals: [{ id: 'g1', statement: 'A' }], guardrails: [] }} onChange={onChange} />,
    )
    fireEvent.click(screen.getByTestId('project-goal-add-metric'))
    expect(onChange.mock.calls[0][0].goals[0].metric).toEqual({ direction: 'up' })

    rerender(<ProjectGoalsEditor value={{ goals: [{ id: 'g1', statement: 'A', metric }], guardrails: [] }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('project-goal-metric-target'), { target: { value: '200' } })
    expect(onChange.mock.calls[1][0].goals[0].metric).toEqual({ ...metric, target: 200 })

    fireEvent.click(screen.getByTestId('project-goal-remove-metric'))
    expect(onChange.mock.calls[2][0].goals[0].metric).toBeNull()
  })
})
