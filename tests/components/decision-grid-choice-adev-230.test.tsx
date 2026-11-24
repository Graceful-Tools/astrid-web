/**
 * ADEV-230 (web side of iOS ADEV-229): a Decision followed by a trade-off grid with exactly
 * as many rows as options draws as the question and the grid only, with no cards. Rows are the
 * choice: tap a row, confirm, post the same reply a card posts. A grid with a different row
 * count, or no grid, keeps the cards.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, replacements?: Record<string, string>) =>
      replacements ? `${key} ${Object.values(replacements).join(' ')}`.trim() : key,
    tArray: () => [],
    locale: 'en',
    messages: null,
  }),
}))

import { DecisionCards } from '@/components/task-detail/DecisionCards'
import { parseDecision } from '@/lib/comment-formats'

const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'contracts/fixtures/decisions.json'), 'utf8'))
const canonical: string = fixtures.decisions.find((d: { name: string }) => d.name === 'canonical example').text

const NO_GRID = '**Decision:** Ship today?\n\n- **1.** Yes (recommended)\n- **2.** No'
const SHORT_GRID = [
  '**Decision:** Which one?',
  '',
  '- **1.** Alpha',
  '- **2.** Beta',
  '- **3.** Gamma',
  '',
  '| Option | Cost |',
  '|---|---|',
  '| 1. Alpha | + cheap |',
  '| 2. Beta | - dear |',
].join('\n')

function draw(text: string, props: { chosen?: number | null; onChoose?: (reply: string) => void } = {}) {
  const decision = parseDecision(text)
  if (!decision) throw new Error('fixture is not a decision')
  return render(<DecisionCards decision={decision} chosen={props.chosen ?? null} onChoose={props.onChoose} />)
}

function bodyRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.tradeoff tbody tr'))
}

describe('a decision with a matching grid is one grid (ADEV-230)', () => {
  it('draws the canonical example as the grid alone, with no option cards', () => {
    const { container } = draw(canonical, { onChoose: vi.fn() })
    expect(container.querySelector('.tradeoff')).not.toBeNull()
    expect(container.querySelectorAll('.decision-card')).toHaveLength(0)
    expect(bodyRows(container)).toHaveLength(3)
  })

  it('while open, hints and turns a row tap into a confirmed reply', () => {
    const onChoose = vi.fn()
    const { container } = draw(canonical, { onChoose })
    expect(screen.getByText('tasks.decision.tapRowHint')).toBeTruthy()

    // A tap on any cell of row 2 asks first; nothing is posted yet.
    const cell = bodyRows(container)[1].querySelector('td:last-child') as HTMLElement
    fireEvent.click(cell)
    expect(onChoose).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('tasks.decision.confirmTitle')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /tasks\.decision\.chooseOption 2 — Mountain cabin/ }))
    expect(onChoose).toHaveBeenCalledWith('2 — Mountain cabin')
  })

  it('cancelling the confirmation posts nothing', () => {
    const onChoose = vi.fn()
    const { container } = draw(canonical, { onChoose })
    fireEvent.click(bodyRows(container)[0])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'actions.cancel' }))
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('marks the recommended row', () => {
    const { container } = draw(canonical, { onChoose: vi.fn() })
    const rows = bodyRows(container)
    expect(rows[0].dataset.recommended).toBe('true')
    expect(rows[1].dataset.recommended).toBeUndefined()
  })

  it('once answered: the chosen row is marked, the others dimmed, no hint and no tap', () => {
    const onChoose = vi.fn()
    const { container } = draw(canonical, { chosen: 2, onChoose })
    const rows = bodyRows(container)
    expect(rows[1].dataset.chosen).toBe('true')
    expect(rows[0].dataset.dimmed).toBe('true')
    expect(rows[2].dataset.dimmed).toBe('true')
    expect(screen.queryByText('tasks.decision.tapRowHint')).toBeNull()
    fireEvent.click(rows[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('your own unanswered question (no onChoose) shows the grid but takes no taps', () => {
    const { container } = draw(canonical)
    expect(container.querySelectorAll('.decision-card')).toHaveLength(0)
    expect(screen.queryByText('tasks.decision.tapRowHint')).toBeNull()
    fireEvent.click(bodyRows(container)[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('without a matching grid the cards stay (ADEV-230)', () => {
  it('no grid: cards', () => {
    const { container } = draw(NO_GRID, { onChoose: vi.fn() })
    expect(container.querySelectorAll('.decision-card')).toHaveLength(2)
  })

  it('a grid with a different row count: cards, then the grid', () => {
    const { container } = draw(SHORT_GRID, { onChoose: vi.fn() })
    expect(container.querySelectorAll('.decision-card')).toHaveLength(3)
    expect(container.querySelector('.tradeoff')).not.toBeNull()
    expect(screen.queryByText('tasks.decision.tapRowHint')).toBeNull()
  })
})
