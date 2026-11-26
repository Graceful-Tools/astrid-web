/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-281 (Goal signals 4b), the parts a person sees: the label chip with its reason lines on the
 * estimate card, the Policy sort offered only where a policy is stated, and the pure helpers behind
 * the trade-off section of the agent policy (a policy is stated by a switch; nothing stated, nothing drawn).
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EstimateCard, type EstimateCardData } from '@/components/projects/EstimateCard'
import { SORT_BY_OPTIONS, MY_TASKS_SORT_BY_OPTIONS, visibleOptions } from '@/components/list-settings/filter-options'
import { knownLabel, labelReasonLines } from '@/lib/estimate-card'
import {
  defaultTradeoffPolicy,
  mayAgent,
  overrideTradeoffFor,
  resolvePolicy,
  tradeoffFor,
  withGoalOrder,
  withTradeoffField,
  withTradeoffStated,
  withAutonomy,
  defaultOrchestrationPolicy,
} from '@/lib/orchestration-policy'

const PROJECT = {
  goals: [{ id: 'g1', statement: 'Faster pages' }],
  guardrails: [{ id: 'r1', statement: 'p95 under 400ms', kind: 'stated' as const }],
}

const estimate = (overrides: Partial<EstimateCardData> = {}): EstimateCardData => ({
  id: 'e1',
  source: 'service:acme',
  createdAt: new Date().toISOString(),
  rough: false,
  confidence: 'high',
  goalImpacts: [{ goalId: 'g1', delta: 2, low: 1, high: 3, kind: 'absolute' }],
  guardrailImpacts: [{ guardrailId: 'r1', delta: 0, low: 0, high: 0, breachProbability: 0.3 }],
  risk: { level: 'low', factors: [] },
  costMicrocents: null,
  effortHours: null,
  reach: null,
  rationale: null,
  ...overrides,
})

describe('the label chip (ADEV-281)', () => {
  it('draws nothing when no policy is stated, which is when the server stores no label', () => {
    render(<EstimateCard estimate={estimate()} project={PROJECT} />)
    expect(screen.queryByTestId('estimate-label-chip')).toBeNull()
  })

  it('names the label and, on tap, the reason lines with the numbers that produced it', () => {
    render(
      <EstimateCard
        estimate={estimate({
          label: 'needs-review',
          labelReasons: [{ code: 'guardrailAtReview', guardrailId: 'r1', breachProbability: 0.3, threshold: 0.1 }],
        })}
        project={PROJECT}
      />,
    )
    const chip = screen.getByTestId('estimate-label-chip')
    expect(chip).toHaveTextContent('Needs review')
    expect(chip).toHaveAttribute('data-label', 'needs-review')
    expect(chip.getAttribute('title')).toBe('p95 under 400ms: breach probability 0.3 is at the review point of 0.1.')

    fireEvent.click(chip)
    expect(screen.getByTestId('estimate-label-reason')).toHaveTextContent('p95 under 400ms: breach probability 0.3 is at the review point of 0.1.')
  })

  it('draws no chip for a label a newer core adds, rather than guessing at it', () => {
    render(<EstimateCard estimate={estimate({ label: 'ship-it', labelReasons: [] })} project={PROJECT} />)
    expect(screen.queryByTestId('estimate-label-chip')).toBeNull()
    expect(knownLabel('ship-it')).toBeNull()
  })
})

describe('reason lines (ADEV-281)', () => {
  it('words every code the core has, with the stated names', () => {
    const lines = labelReasonLines(
      [
        { code: 'goalImproves', goalId: 'g1', delta: 2 },
        { code: 'riskAtReview', level: 'medium', threshold: 'medium' },
        { code: 'experimentFirst', confidence: 'low', risk: 'high' },
        { code: 'noEstimate' },
        { code: 'someFutureCode' },
      ],
      PROJECT,
    )
    expect(lines.map(line => line.code)).toEqual(['goalImproves', 'riskAtReview', 'experimentFirst', 'noEstimate'])
    expect(lines[0].values).toEqual({ name: 'Faster pages', delta: '+2' })
    expect(lines[1].levels).toEqual(['level', 'threshold'])
  })
})

describe('the Policy sort is offered only where a policy is stated (ADEV-281)', () => {
  it('is in SORT_BY_OPTIONS but hidden without a policy', () => {
    expect(SORT_BY_OPTIONS.map(option => option.value)).toContain('policy')
    expect(visibleOptions(SORT_BY_OPTIONS, false).map(option => option.value)).not.toContain('policy')
    expect(visibleOptions(SORT_BY_OPTIONS, true).map(option => option.value)).toContain('policy')
  })

  it('is not one of My Tasks\' orders, which the preferences API would refuse', () => {
    expect(MY_TASKS_SORT_BY_OPTIONS.map(option => option.value)).not.toContain('policy')
  })
})

describe('editing the trade-off policy (ADEV-281)', () => {
  it('states a policy with a switch, and withdrawing it states none', () => {
    const stated = withTradeoffStated(null, true)
    expect(stated).toEqual({ tradeoff: {} })
    expect(resolvePolicy(stated, null).tradeoff).toEqual(defaultTradeoffPolicy())
    expect(withTradeoffStated(stated, false)).toBeNull()
    expect(resolvePolicy(null, null).tradeoff).toBeUndefined()
  })

  it('sets one threshold at a time and an unset one inherits', () => {
    const next = withTradeoffField(withTradeoffStated(null, true), 'riskReviewAt', 'low')
    expect(next).toEqual({ tradeoff: { risk: { reviewAt: 'low' } } })
    expect(overrideTradeoffFor(next, 'riskReviewAt')).toBe('low')
    expect(tradeoffFor(resolvePolicy(next, null).tradeoff!, 'riskReviewAt')).toBe('low')
    expect(tradeoffFor(resolvePolicy(next, null).tradeoff!, 'riskRefuseAt')).toBe('high')
    // Clearing the last field leaves the policy stated, on its defaults.
    expect(withTradeoffField(next, 'riskReviewAt', undefined)).toEqual({ tradeoff: {} })
  })

  it('refuses a probability outside 0 to 1 rather than storing it', () => {
    // The editor offers fixed choices; a bad value from anywhere else reads as nothing stored.
    expect(withTradeoffField(null, 'guardrailRefuse', 1.5)).toBeNull()
    expect(withTradeoffField(null, 'guardrailRefuse', 0.25)).toEqual({ tradeoff: { guardrail: { refuseAtBreachProbability: 0.25 } } })
  })

  it('stores the goal order and lets it inherit again', () => {
    const ordered = withGoalOrder(withTradeoffStated(null, true), ['g2', 'g1'])
    expect(ordered).toEqual({ tradeoff: { goalOrder: ['g2', 'g1'] } })
    expect(withGoalOrder(ordered, undefined)).toEqual({ tradeoff: {} })
  })

  it('has the three new actions, each defaulting to never, settable like the others', () => {
    const policy = defaultOrchestrationPolicy()
    expect([policy.autonomy.promoteIdea, policy.autonomy.experimentStart, policy.autonomy.experimentStop]).toEqual(['never', 'never', 'never'])
    expect(withAutonomy(null, 'promoteIdea', 'ask')).toEqual({ autonomy: { promoteIdea: 'ask' } })
    expect(withAutonomy(null, 'experimentStop', 'allowed')).toEqual({ autonomy: { experimentStop: 'allowed' } })
  })

  it('promoteIdea needs a do-now estimate, as confident as the policy asks', () => {
    const policy = resolvePolicy({ autonomy: { promoteIdea: 'allowed' }, tradeoff: { minConfidenceToAct: 'high' } }, null)
    expect(mayAgent(policy, 'claude', 'promoteIdea').reason).toBe('noEstimate')
    expect(mayAgent(policy, 'claude', 'promoteIdea', null, { label: 'experiment-first', confidence: 'high' }).reason).toBe('notDoNow')
    expect(mayAgent(policy, 'claude', 'promoteIdea', null, { label: 'do-now', confidence: 'medium' }).reason).toBe('belowConfidence')
    expect(mayAgent(policy, 'claude', 'promoteIdea', null, { label: 'do-now', confidence: 'high' })).toEqual({ decision: 'allowed', mustAsk: false, reason: 'policy' })
  })
})
