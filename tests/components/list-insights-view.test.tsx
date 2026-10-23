/**
 * The Insights tab's content (AWTD-1329) for a given server answer.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListInsightsView, formatInsightDuration } from '@/components/list-insights/ListInsightsPanel'
import type { ListInsights } from '@/lib/list-insights'

const HOUR = 60 * 60 * 1000

const INSIGHTS: ListInsights = {
  window: { days: 7, timeZone: 'UTC', start: '2026-10-16', end: '2026-10-22' },
  series: [
    { date: '2026-10-21', created: 2, completed: 1 },
    { date: '2026-10-22', created: 1, completed: 3 },
  ],
  totals: { created: 3, completed: 4 },
  createToComplete: { medianMs: 5 * HOUR, sampleSize: 4 },
  lanes: [
    { role: 'inbox', name: 'Inbox', medianMs: null, sampleSize: 0 },
    { role: 'doing', name: 'Doing', medianMs: 2 * HOUR, sampleSize: 2 },
  ],
  contributors: [
    { userId: 'claude', name: 'Claude', image: null, isAIAgent: true, completed: 3, inspired: 1, supported: 2, created: 1, edited: 4, commented: 2, total: 6 },
  ],
}

const view = (overrides: Partial<Parameters<typeof ListInsightsView>[0]> = {}) =>
  render(<ListInsightsView insights={INSIGHTS} failed={false} days={7} onDaysChange={vi.fn()} {...overrides} />)

describe('ListInsightsView (AWTD-1329)', () => {
  it('shows the totals, the medians and the contributors', () => {
    view()
    expect(screen.getByText(/3 new/)).toBeInTheDocument()
    expect(screen.getByText(/4 completed/)).toBeInTheDocument()
    expect(screen.getByText('5 h')).toBeInTheDocument()
    expect(screen.getByText('Doing')).toBeInTheDocument()
    expect(screen.getByText('2 h')).toBeInTheDocument()
    expect(screen.getByText('Claude')).toBeInTheDocument()
  })

  it('shows the profile metrics for each contributor, then their activity (AWTD-1333)', () => {
    view()
    expect(screen.getByText('3 completed · 1 inspired · 2 supported')).toBeInTheDocument()
    expect(screen.getByText('1 created · 4 edits · 2 comments')).toBeInTheDocument()
  })

  it('says a board has no lane history yet rather than showing zeros', () => {
    view({ insights: { ...INSIGHTS, lanes: INSIGHTS.lanes!.map(lane => ({ ...lane, medianMs: null, sampleSize: 0 })) } })
    expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument()
  })

  it('leaves the lane section out for a list that is not a board', () => {
    view({ insights: { ...INSIGHTS, lanes: null } })
    expect(screen.queryByText('Doing')).not.toBeInTheDocument()
  })

  it('asks for another window', async () => {
    const onDaysChange = vi.fn()
    view({ onDaysChange })
    await userEvent.click(screen.getByRole('button', { name: '90 days' }))
    expect(onDaysChange).toHaveBeenCalledWith(90)
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows loading and failure states', () => {
    const { rerender } = view({ insights: null })
    expect(screen.getByText(/Loading insights/)).toBeInTheDocument()
    rerender(<ListInsightsView insights={null} failed days={7} onDaysChange={vi.fn()} />)
    expect(screen.getByText(/Couldn't load insights/)).toBeInTheDocument()
  })
})

describe('formatInsightDuration', () => {
  const t = (key: string, params?: Record<string, string>) =>
    `${params?.n} ${key.split('.').pop()}`
  it('picks minutes, hours or days', () => {
    expect(formatInsightDuration(5 * 60 * 1000, t as never)).toBe('5 minutes')
    expect(formatInsightDuration(5 * HOUR, t as never)).toBe('5 hours')
    expect(formatInsightDuration(72 * HOUR, t as never)).toBe('3 days')
  })
})
