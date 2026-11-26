/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-280 (Goal signals 3b): the Estimate button on an idea and in task details, and the estimate
 * card. One button, a picker only for several estimators, an explanation when there is no key, a
 * "rough estimate" tag with ranges only for the built-in model, and nothing at all outside Project Mode
 * or for a project that states nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(readonly status: number, readonly detail: unknown) {
      super(`API call failed: ${status}`)
    }
  }
  return { apiGet: vi.fn(), apiPost: vi.fn(), ApiError: FakeApiError }
})
const FakeApiError = api.ApiError
vi.mock('@/lib/api', () => api)
const mode = vi.hoisted(() => ({ on: true }))
vi.mock('@/hooks/use-project-mode', () => ({ useProjectMode: () => mode.on }))

import { EstimateControl, resetEstimatorOffering } from '@/components/projects/EstimateControl'
import { EstimateCard, type EstimateCardData } from '@/components/projects/EstimateCard'
import { __clearProjectGoalsCache } from '@/hooks/use-project-goals'
import { formatDollars, goalRows, guardrailRows, opportunity, estimateAge, rangeDomain, rangePercent } from '@/lib/estimate-card'

const PROJECT = {
  goals: [{ id: 'g1', statement: 'Faster pages', metric: { direction: 'down' as const, target: 2, current: 3.5, unit: 's' } }],
  guardrails: [
    {
      id: 'r1',
      statement: 'p95 under 400ms',
      kind: 'enforced' as const,
      check: { type: 'metric' as const, source: { connectorId: 'c', metricKey: 'p95' }, op: '<=' as const, threshold: 400, unit: 'ms', current: 350 },
    },
  ],
}

const estimate = (overrides: Partial<EstimateCardData> = {}): EstimateCardData => ({
  id: 'e1',
  source: 'builtin_llm',
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  rough: true,
  confidence: 'low',
  goalImpacts: [{ goalId: 'g1', delta: -0.4, low: -0.9, high: -0.1, unit: 's', kind: 'absolute' }],
  guardrailImpacts: [{ guardrailId: 'r1', delta: 12, low: 0, high: 40, breachProbability: 0.05 }],
  risk: { level: 'medium', factors: ['touches checkout'] },
  costMicrocents: 1_800_000_000,
  effortHours: 12,
  reach: { count: 41_000, unit: 'users', period: 'month' },
  rationale: 'Because.',
  ...overrides,
})

function serve(opts: { estimators?: Array<{ key: string; name: string }>; latest?: EstimateCardData | null; project?: unknown } = {}) {
  const estimators = opts.estimators ?? [{ key: 'builtin', name: 'Built-in estimator' }]
  api.apiGet.mockImplementation(async (url: string) => ({
    json: async () => {
      if (url.includes('/capabilities')) return { goalSignals: { estimators } }
      if (url.includes('/estimates')) return { latest: opts.latest ?? null, history: [] }
      return { projectId: 'p1', ...((opts.project ?? PROJECT) as object), canEdit: true }
    },
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mode.on = true
  resetEstimatorOffering()
  __clearProjectGoalsCache()
})

describe('estimate card derivations (ADEV-280)', () => {
  it('puts the reference line at the change that reaches the target or the limit', () => {
    expect(goalRows(estimate().goalImpacts, PROJECT, false)[0].reference).toBeCloseTo(-1.5)
    expect(guardrailRows(estimate().guardrailImpacts, PROJECT, false)[0].reference).toBe(50)
  })

  it('places a value along the axis and keeps it on the axis', () => {
    expect(rangePercent(5, [0, 10])).toBe(50)
    expect(rangePercent(-5, [0, 10])).toBe(0)
    expect(rangePercent(50, [0, 10])).toBe(100)
    expect(rangePercent(1, [3, 3])).toBe(50)
  })

  it('draws no reference line without numbers to measure from', () => {
    const bare = { goals: [{ id: 'g1', statement: 'Faster pages' }], guardrails: [{ id: 'r1', statement: 'x', kind: 'stated' as const }] }
    expect(goalRows(estimate().goalImpacts, bare, false)[0].reference).toBeNull()
    expect(guardrailRows(estimate().guardrailImpacts, bare, false)[0].reference).toBeNull()
  })

  it('drops the point estimate for a rough one: ranges only', () => {
    expect(goalRows(estimate().goalImpacts, PROJECT, true)[0].delta).toBeNull()
    expect(guardrailRows(estimate().guardrailImpacts, PROJECT, true)[0].breachProbability).toBeUndefined()
  })

  it('works opportunity out as reach times impact, and not at all without both', () => {
    expect(opportunity({ count: 1000, unit: 'users', period: 'month' }, estimate().goalImpacts)).toMatchObject({ low: -900, high: -100 })
    expect(opportunity(null, estimate().goalImpacts)).toBeNull()
    expect(opportunity({ count: 1, unit: 'users', period: 'month' }, [])).toBeNull()
  })

  it('formats cost, age and the axis', () => {
    expect(formatDollars(1_800_000_000)).toBe('$18')
    expect(estimateAge(new Date(Date.now() - 3 * 3_600_000).toISOString(), new Date())).toEqual({ unit: 'hours', n: 3 })
    const [min, max] = rangeDomain(goalRows(estimate().goalImpacts, PROJECT, false))
    expect(min).toBeLessThan(-1.5)
    expect(max).toBeGreaterThan(0)
  })
})

describe('EstimateCard (ADEV-280)', () => {
  it('says rough estimate for the built-in model, with source, confidence and age always shown', () => {
    render(<EstimateCard estimate={estimate()} project={PROJECT} />)
    expect(screen.getByTestId('estimate-rough')).toHaveTextContent('Rough estimate')
    expect(screen.getByTestId('estimate-meta')).toHaveTextContent('Source: Built-in model')
    expect(screen.getByTestId('estimate-confidence')).toHaveTextContent('Low confidence')
    expect(screen.getByTestId('estimate-age')).toHaveTextContent('3 h ago')
    expect(screen.getAllByTestId('estimate-range-row')).toHaveLength(2)
  })

  it('shows a service estimate without the rough tag, and a reference line per row that has one', () => {
    render(<EstimateCard estimate={estimate({ rough: false, source: 'service:acme', confidence: 'high' })} project={PROJECT} />)
    expect(screen.queryByTestId('estimate-rough')).toBeNull()
    expect(screen.getByTestId('estimate-meta')).toHaveTextContent('Source: acme')
    expect(screen.getByTestId('estimate-goal-bars')).toHaveTextContent('Faster pages')
    // The goal and the guardrail both state numbers, so each bar carries its target or limit.
    expect(screen.getAllByTestId('estimate-reference-line').map(line => line.getAttribute('data-reference'))).toEqual(['-1.5', '50'])
    expect(screen.getByText(/5% chance of breach/)).toBeInTheDocument()
  })

  it('shows the risk chip with its factors and the three tiles', () => {
    render(<EstimateCard estimate={estimate()} project={PROJECT} />)
    expect(screen.getByTestId('estimate-risk-chip')).toHaveTextContent('Medium risk')
    expect(screen.getByTestId('estimate-risk-factor')).toHaveTextContent('touches checkout')
    expect(screen.getByTestId('estimate-tile-impact')).toHaveTextContent('-0.9 to -0.1 s')
    expect(screen.getByTestId('estimate-tile-cost')).toHaveTextContent('$18')
    expect(screen.getByTestId('estimate-tile-cost')).toHaveTextContent('12 h of effort')
    expect(screen.getByTestId('estimate-tile-opportunity')).toHaveTextContent('/ month')
  })

  it('says "not estimated" for a missing section rather than a zero', () => {
    render(<EstimateCard estimate={estimate({ costMicrocents: null, effortHours: null, reach: null, goalImpacts: [] })} project={PROJECT} />)
    expect(screen.getByTestId('estimate-tile-cost')).toHaveTextContent('Not estimated')
    expect(screen.getByTestId('estimate-tile-impact')).toHaveTextContent('Not estimated')
    expect(screen.getByTestId('estimate-tile-opportunity')).toHaveTextContent('Not estimated')
  })
})

describe('EstimateControl (ADEV-280)', () => {
  it('draws nothing outside Project Mode', async () => {
    mode.on = false
    serve()
    const { container } = render(<EstimateControl taskId="t1" projectId="p1" />)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container).toBeEmptyDOMElement()
    expect(api.apiGet).not.toHaveBeenCalled()
  })

  it('draws nothing when the project states no goals or guardrails', async () => {
    serve({ project: { goals: [], guardrails: [] } })
    const { container } = render(<EstimateControl taskId="t1" projectId="p1" />)
    await waitFor(() => expect(api.apiGet).toHaveBeenCalledWith(expect.stringContaining('/goals')))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.querySelector('[data-testid="estimate-control"]')).toBeNull()
  })

  it('is one button with no picker when one estimator is offered, and shows the card it gets', async () => {
    serve()
    api.apiPost.mockResolvedValue({ status: 201, json: async () => ({ estimate: estimate() }) })
    render(<EstimateControl taskId="t1" projectId="p1" />)
    const button = await screen.findByTestId('estimate-button')
    expect(screen.queryByTestId('estimate-picker')).toBeNull()
    fireEvent.click(button)
    expect(await screen.findByTestId('estimate-card')).toBeInTheDocument()
    expect(api.apiPost).toHaveBeenCalledWith('/api/v1/tasks/t1/estimates', { estimator: 'builtin', projectId: 'p1' })
  })

  it('offers a picker only when more than one estimator is configured', async () => {
    serve({ estimators: [{ key: 'builtin', name: 'Built-in estimator' }, { key: 'acme', name: 'Acme' }] })
    render(<EstimateControl taskId="t1" projectId="p1" />)
    expect(await screen.findByTestId('estimate-picker')).toBeInTheDocument()
  })

  it('explains how to add a key when the built-in estimator has none', async () => {
    serve()
    api.apiPost.mockRejectedValue(new FakeApiError(409, { error: 'No key', reason: 'no_api_key' }))
    render(<EstimateControl taskId="t1" projectId="p1" />)
    fireEvent.click(await screen.findByTestId('estimate-button'))
    expect(await screen.findByTestId('estimate-error')).toHaveTextContent('Add an AI provider key in Settings')
  })

  it('says a service is still working on a 202', async () => {
    serve({ estimators: [{ key: 'acme', name: 'Acme' }] })
    api.apiPost.mockResolvedValue({ status: 202, json: async () => ({ pending: true, estimator: 'acme' }) })
    render(<EstimateControl taskId="t1" projectId="p1" />)
    fireEvent.click(await screen.findByTestId('estimate-button'))
    expect(await screen.findByTestId('estimate-pending')).toHaveTextContent('Acme is still working')
  })

  it('shows the standing estimate in task details without asking again', async () => {
    serve({ latest: estimate() })
    render(<EstimateControl taskId="t1" projectId="p1" />)
    expect(await screen.findByTestId('estimate-card')).toBeInTheDocument()
    expect(api.apiPost).not.toHaveBeenCalled()
    expect(screen.getByTestId('estimate-button')).toHaveTextContent('Estimate again')
  })

  it('on an idea card, reads nothing until opened and never lets a click reach the card', async () => {
    serve({ latest: estimate() })
    const onCard = vi.fn()
    render(
      <div onClick={onCard}>
        <EstimateControl taskId="t1" projectId="p1" compact />
      </div>,
    )
    const show = await screen.findByTestId('estimate-show')
    expect(api.apiGet).not.toHaveBeenCalledWith(expect.stringContaining('/estimates'))
    fireEvent.click(show)
    expect(await screen.findByTestId('estimate-card')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('estimate-button'))
    expect(onCard).not.toHaveBeenCalled()
  })
})
