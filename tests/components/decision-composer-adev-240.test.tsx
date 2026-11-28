/**
 * ADEV-240: "Ask for a decision" from task details on web. Compose a question, two options,
 * one criterion and a light, then post: the thread draws one choosable grid and no cards
 * (the ADEV-229/230 rule), because the composer gives the grid one row per option.
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, replacements?: Record<string, string>) =>
      replacements ? `${key} ${Object.values(replacements).join(' ')}`.trim() : key,
    tArray: () => [],
    locale: 'en',
    messages: null,
  }),
}))

import { DecisionComposer } from '@/components/task-detail/DecisionComposer'
import { DecisionCards } from '@/components/task-detail/DecisionCards'
import { parseDecision } from '@/lib/comment-formats'

function type(label: string | RegExp, value: string, index = 0) {
  fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } })
}

describe('the decision composer (ADEV-240)', () => {
  it('composes, posts as a comment, and the thread draws one choosable grid with no cards', async () => {
    const onPost = vi.fn()
    render(<DecisionComposer open onClose={vi.fn()} canEditDescription onPost={onPost} />)

    fireEvent.change(screen.getByLabelText('tasks.decisionComposer.question'), { target: { value: 'Where?' } })
    type(/tasks\.decisionComposer\.optionPlaceholder 1/, 'Lisbon')
    type(/tasks\.decisionComposer\.optionPlaceholder 2/, 'Cabin')
    fireEvent.click(screen.getAllByLabelText('tasks.decisionComposer.recommendHint')[0])

    fireEvent.click(screen.getByText('tasks.decisionComposer.addCriterion'))
    type('tasks.decisionComposer.criterionPlaceholder', 'Cost')
    // Option 1, Cost: Good, with a note.
    fireEvent.click(screen.getAllByLabelText('tasks.tradeoffRatings.good')[0])
    type('tasks.decisionComposer.reasonPlaceholder', 'cheap flights', 0)

    // The live preview already draws the grid, not cards.
    const preview = screen.getByTestId('decision-composer-preview')
    expect(preview.querySelector('.tradeoff')).not.toBeNull()
    expect(preview.querySelectorAll('.decision-card')).toHaveLength(0)

    fireEvent.click(screen.getByTestId('decision-composer-post'))
    await Promise.resolve()
    expect(onPost).toHaveBeenCalledWith(
      '**Decision:** Where?\n\n- **1.** Lisbon (recommended)\n- **2.** Cabin\n\n| Option | Cost |\n|---|---|\n| 1. Lisbon | + cheap flights |\n| 2. Cabin |  |',
      'comment',
    )

    // What was posted, drawn in the thread for someone else to answer.
    const posted = parseDecision(onPost.mock.calls[0][0])!
    const { container } = render(<DecisionCards decision={posted} chosen={null} onChoose={vi.fn()} />)
    expect(container.querySelectorAll('.decision-card')).toHaveLength(0)
    expect(container.querySelectorAll('.tradeoff tbody tr[data-choosable]')).toHaveLength(2)
  })

  it('ADEV-356: the dialog column can shrink to the viewport, so a wide row cannot overflow it', () => {
    render(<DecisionComposer open onClose={vi.fn()} canEditDescription onPost={vi.fn()} />)
    const dialog = screen.getByTestId('decision-composer')
    expect(dialog.className).toContain('grid-cols-[minmax(0,1fr)]')
    expect(dialog.className).toContain('overflow-x-hidden')
    expect(dialog.className).toContain('w-[calc(100vw-1rem)]')
  })

  it('a note with no colour blocks posting', () => {
    render(<DecisionComposer open onClose={vi.fn()} canEditDescription={false} onPost={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('tasks.decisionComposer.question'), { target: { value: 'Which?' } })
    type(/tasks\.decisionComposer\.optionPlaceholder 1/, 'A')
    type(/tasks\.decisionComposer\.optionPlaceholder 2/, 'B')
    fireEvent.click(screen.getByText('tasks.decisionComposer.addCriterion'))
    type('tasks.decisionComposer.criterionPlaceholder', 'Cost')
    type('tasks.decisionComposer.reasonPlaceholder', 'cheap', 0)
    expect(screen.getByRole('alert').textContent).toBe('tasks.decisionComposer.reasonNeedsColour')
    expect((screen.getByTestId('decision-composer-post') as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers "In description" only to someone who may edit the task', () => {
    const { unmount } = render(<DecisionComposer open onClose={vi.fn()} canEditDescription={false} onPost={vi.fn()} />)
    expect(screen.queryByText('tasks.decisionComposer.inDescription')).toBeNull()
    unmount()
    render(<DecisionComposer open onClose={vi.fn()} canEditDescription onPost={vi.fn()} />)
    expect(screen.getByText('tasks.decisionComposer.inDescription')).toBeTruthy()
  })
})
