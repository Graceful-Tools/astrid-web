/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-282 (Goal signals 5c): the experiment row in task details, the picker, the one-tap offer to add
 * the Pending results column, and the card line that says what a pending task waits for.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  refusalReason: vi.fn(() => null),
}))
vi.mock('@/lib/api', () => api)

const goalSignals = vi.hoisted(() => ({ on: true }))
vi.mock('@/hooks/use-goal-signals', () => ({ useGoalSignals: () => goalSignals.on }))

const session = vi.hoisted(() => ({ userId: 'owner' }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: session.userId } } }) }))

import { TaskDetailExperimentRow } from '@/components/task-detail/TaskDetailExperimentRow'
import { PendingResultsLine } from '@/components/projects/PendingResultsLine'
import { resetTaskExperimentsCache } from '@/hooks/use-task-experiments'
import { __clearLoadedProjectsCache } from '@/lib/client-projects'
import { isResultsNeedsCondition } from '@/lib/results-prompt'
import { ageLabel, formatRelDelta, staleLink, waitingOn, type ExperimentView } from '@/lib/task-experiment-client'
import type { Task } from '@/types/task'

const HOUR = 3_600_000
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString()

function link(overrides: Partial<ExperimentView> = {}): ExperimentView {
  return {
    id: 'e1',
    taskId: 't1',
    projectId: 'p1',
    kind: 'experiment',
    connectorId: 'c1',
    externalKey: 'checkout-v2',
    url: 'https://experiments.example/checkout-v2',
    state: 'running',
    verdict: null,
    recommendation: null,
    metrics: [],
    findings: [],
    startedAt: iso(24),
    decideBy: null,
    fetchedAt: iso(1),
    stale: false,
    lastError: null,
    ...overrides,
  }
}

const task = { id: 't1', title: 'Speed up checkout', lists: [{ id: 'l1', projectId: 'p1' }] } as unknown as Task

function serve(experiments: ExperimentView[], options: { customStates?: unknown[]; ownerId?: string; inResultsColumn?: boolean } = {}) {
  api.apiGet.mockImplementation(async (url: string) => ({
    json: async () => {
      if (url.endsWith('/experiment')) return { experiments, inResultsColumn: options.inResultsColumn ?? false }
      if (url.endsWith('/connectors')) return { connectors: [{ id: 'c1', name: 'Growthbook', kind: 'experiment' }] }
      if (url === '/api/v1/projects') {
        return { projects: [{ id: 'p1', ownerId: options.ownerId ?? 'owner', members: [], customStates: options.customStates ?? [] }] }
      }
      return {}
    },
  }))
  api.apiPost.mockResolvedValue({ json: async () => ({ experiments, inResultsColumn: false }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  goalSignals.on = true
  session.userId = 'owner'
  resetTaskExperimentsCache()
  __clearLoadedProjectsCache()
  localStorage.clear()
})

describe('experiment helpers (ADEV-282)', () => {
  it('formats a relative delta with its sign', () => {
    expect(formatRelDelta(0.042)).toBe('+4.2%')
    expect(formatRelDelta(-0.01)).toBe('-1.0%')
  })

  it('reads an age in the coarsest unit', () => {
    const now = new Date('2026-11-26T12:00:00Z')
    expect(ageLabel('2026-11-23T12:00:00Z', now)).toBe('3d')
    expect(ageLabel('2026-11-26T07:00:00Z', now)).toBe('5h')
  })

  it('waits on the first open link and flags a stale open one', () => {
    const concluded = link({ id: 'a', state: 'concluded', stale: true })
    const open = link({ id: 'b', stale: true })
    expect(waitingOn([concluded, open])?.id).toBe('b')
    expect(staleLink([concluded, open])?.id).toBe('b')
    expect(staleLink([concluded])).toBeNull()
  })

  it('recognises the server asking what a task waits for', () => {
    expect(isResultsNeedsCondition({ status: 422, detail: { code: 'RESULTS_NEEDS_CONDITION' } })).toBe(true)
    expect(isResultsNeedsCondition({ status: 422, detail: { code: 'WAITING_NEEDS_CONDITION' } })).toBe(false)
    expect(isResultsNeedsCondition(new Error('x'))).toBe(false)
  })
})

describe('TaskDetailExperimentRow (ADEV-282)', () => {
  it('shows state, verdict, per-metric deltas, the recommendation and a link out', async () => {
    serve([
      link({
        state: 'concluded',
        verdict: 'improving',
        metrics: [{ metricKey: 'conversion', relDelta: 0.042, significant: true }],
        recommendation: { action: 'ship', reason: 'clear win' },
      }),
    ])
    render(<TaskDetailExperimentRow task={task} />)
    expect(await screen.findByTestId('experiment-verdict')).toHaveTextContent('Improving')
    expect(screen.getByTestId('experiment-state')).toHaveTextContent('Concluded')
    expect(screen.getByTestId('experiment-metrics')).toHaveTextContent('conversion +4.2%')
    expect(screen.getByTestId('experiment-recommendation')).toHaveTextContent('Recommends ship: clear win')
    expect(screen.getByTestId('experiment-link-out')).toHaveAttribute('href', 'https://experiments.example/checkout-v2')
  })

  it('says "no data since" for a stale open link and refreshes on demand', async () => {
    serve([link({ stale: true, fetchedAt: iso(72) })])
    render(<TaskDetailExperimentRow task={task} />)
    expect(await screen.findByTestId('experiment-stale')).toHaveTextContent('No data since 3d ago')
    fireEvent.click(screen.getByTestId('experiment-refresh'))
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/v1/tasks/t1/experiment/refresh', {}))
  })

  it('draws nothing without goal signals', async () => {
    goalSignals.on = false
    serve([link()])
    const { container } = render(<TaskDetailExperimentRow task={task} />)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.querySelector('[data-testid="task-experiment-row"]')).toBeNull()
    expect(api.apiGet).not.toHaveBeenCalled()
  })

  it('starts a verification from the picker', async () => {
    serve([])
    render(<TaskDetailExperimentRow task={task} />)
    fireEvent.click(await screen.findByTestId('experiment-add'))
    fireEvent.click(await screen.findByTestId('experiment-mode-verification'))
    fireEvent.change(screen.getByTestId('experiment-days-input'), { target: { value: '5' } })
    fireEvent.click(screen.getByTestId('experiment-link-submit'))
    await waitFor(() =>
      expect(api.apiPost).toHaveBeenCalledWith('/api/v1/tasks/t1/experiment', { kind: 'verification', days: 5, projectId: 'p1' }),
    )
  })
})

describe('ResultsColumnOffer (ADEV-282)', () => {
  it('offers the column to the board owner once a task is linked, and adds it in one tap', async () => {
    serve([link()])
    render(<TaskDetailExperimentRow task={task} />)
    fireEvent.click(await screen.findByTestId('results-column-offer-add'))
    await waitFor(() =>
      expect(api.apiPost).toHaveBeenCalledWith('/api/v1/projects/p1/statuses', { preset: 'results' }),
    )
    await waitFor(() => expect(screen.queryByTestId('results-column-offer')).toBeNull())
  })

  it('does not offer it before anything is linked', async () => {
    serve([])
    render(<TaskDetailExperimentRow task={task} />)
    await screen.findByTestId('experiment-add')
    expect(screen.queryByTestId('results-column-offer')).toBeNull()
  })

  it('never shows it to someone who cannot edit the board', async () => {
    session.userId = 'member'
    serve([link()])
    render(<TaskDetailExperimentRow task={task} />)
    await screen.findByTestId('task-experiment-row')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByTestId('results-column-offer')).toBeNull()
  })

  it('does not offer a board that has the column', async () => {
    serve([link()], { customStates: [{ role: 'results', name: 'Pending results', order: 0 }] })
    render(<TaskDetailExperimentRow task={task} />)
    await screen.findByTestId('task-experiment-row')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByTestId('results-column-offer')).toBeNull()
  })

  it('remembers a dismissal per board and does not offer again', async () => {
    serve([link()])
    const first = render(<TaskDetailExperimentRow task={task} />)
    fireEvent.click(await screen.findByTestId('results-column-offer-dismiss'))
    expect(screen.queryByTestId('results-column-offer')).toBeNull()
    first.unmount()
    resetTaskExperimentsCache()
    render(<TaskDetailExperimentRow task={task} />)
    await screen.findByTestId('task-experiment-row')
    expect(screen.queryByTestId('results-column-offer')).toBeNull()
  })
})

describe('PendingResultsLine (ADEV-282)', () => {
  it('says what the card waits for, and "no data since" when the source is stale', async () => {
    serve([link({ stale: true, fetchedAt: iso(50) })], { inResultsColumn: true })
    render(<PendingResultsLine taskId="t1" statusRole="results" />)
    expect(await screen.findByTestId('pending-results-line')).toHaveTextContent('Waiting for checkout-v2')
    expect(screen.getByTestId('pending-results-stale')).toHaveTextContent('No data since 2d ago')
  })

  it('draws nothing, and reads nothing, for a card outside the column', async () => {
    serve([link()])
    const { container } = render(<PendingResultsLine taskId="t1" statusRole="doing" />)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.firstChild).toBeNull()
    expect(api.apiGet).not.toHaveBeenCalled()
  })
})
