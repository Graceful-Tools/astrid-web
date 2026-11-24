/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-188: the grid editor on a decision task's description. It edits criteria, options and
 * cells (a rating plus text; there is no score column) and saves through the description's own
 * save, with the prose around the grid untouched.
 */
import React from 'react'
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

vi.mock('@/hooks/use-identifier-link-context', () => ({ useIdentifierLinkContext: () => undefined }))

import { DecisionGridEditor } from '@/components/task-detail/DecisionGridEditor'
import { TaskDetailDescriptionRow } from '@/components/task-detail/TaskDetailDescriptionRow'
import { editableDecision } from '@/lib/decision-grid'
import { parseDecision } from '@/lib/comment-formats'

const DESCRIPTION = [
  'We recommend #1.',
  '',
  '**Decision:** Where?',
  '',
  '- **1.** Lisbon (recommended)',
  '- **2.** Cabin',
  '',
  '| Option | Cost |',
  '|---|---|',
  '| 1. Lisbon | ~ $1,400 |',
  '| 2. Cabin | + $600 |',
].join('\n')

function open(onSave = vi.fn()) {
  render(<DecisionGridEditor open description={DESCRIPTION} onClose={() => {}} onSave={onSave} />)
  return onSave
}

describe('ADEV-188 decision grid editor', () => {
  it('shows criteria, options and cells, and no score column', () => {
    open()
    const editor = screen.getByTestId('decision-grid-editor')
    expect((within(editor).getByDisplayValue('Cost') as HTMLInputElement).tagName).toBe('INPUT')
    expect(within(editor).getByDisplayValue('Lisbon')).toBeTruthy()
    expect(within(editor).getByDisplayValue('$600')).toBeTruthy()
    expect(editor.textContent ?? '').not.toMatch(/score|total/i)
  })

  it('saves edited cells, criteria and option names into the description', () => {
    const onSave = open()
    fireEvent.change(screen.getByDisplayValue('Cabin'), { target: { value: 'Mountain cabin' } })
    fireEvent.click(screen.getByTestId('grid-editor-rating-1-0-++'))
    fireEvent.change(screen.getByDisplayValue('$600'), { target: { value: '$400' } })
    fireEvent.click(screen.getByTestId('grid-editor-add-criterion'))
    fireEvent.change(screen.getByTestId('grid-editor-criterion-1'), { target: { value: 'Fun' } })
    fireEvent.click(screen.getByTestId('grid-editor-rating-0-1-+'))
    fireEvent.click(screen.getByTestId('grid-editor-save'))
    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0] as string
    const e = editableDecision(saved)!
    expect(e.grid.criteria).toEqual(['Cost', 'Fun'])
    expect(e.grid.options[1]).toEqual({ name: 'Mountain cabin', cells: [{ rating: '++', text: '$400' }, { rating: null, text: '' }] })
    expect(e.grid.options[0].cells[1]).toEqual({ rating: '+', text: '' })
    expect(parseDecision(saved)!.options.map(o => o.text)).toEqual(['Lisbon', 'Mountain cabin'])
    expect(saved.startsWith('We recommend #1.')).toBe(true)
  })

  it('blocks saving a reason with no rating', () => {
    const onSave = open()
    fireEvent.click(screen.getByTestId('grid-editor-rating-1-0-+'))
    expect(screen.getByRole('alert').textContent).toContain('tasks.decisionComposer.reasonNeedsColour')
    fireEvent.click(screen.getByTestId('grid-editor-save'))
    expect(onSave).not.toHaveBeenCalled()
  })
})


function row(description: string, readOnly: boolean, save = vi.fn()) {
  render(
    <TaskDetailDescriptionRow
      task={{ id: 't1', title: 'Decision', description, lists: [] } as never}
      readOnly={readOnly}
      editingDescription={false}
      setEditingDescription={() => {}}
      tempDescription={description}
      setTempDescription={() => {}}
      descriptionRef={{ current: null }}
      descriptionTextareaRef={{ current: null }}
      handleSaveDescription={save}
      handleCancelDescription={() => {}}
    />,
  )
  return save
}

describe('ADEV-188 Edit grid on a decision task', () => {
  it('is offered on a decision description someone may edit, and saves through the description', () => {
    const save = row(DESCRIPTION, false)
    fireEvent.click(screen.getByTestId('decision-grid-edit'))
    fireEvent.click(screen.getByTestId('grid-editor-rating-0-0-++'))
    fireEvent.click(screen.getByTestId('grid-editor-save'))
    expect(save).toHaveBeenCalledTimes(1)
    expect(editableDecision(save.mock.calls[0][0])!.grid.options[0].cells[0]).toEqual({ rating: '++', text: '$1,400' })
  })

  it('is not offered read-only', () => {
    row(DESCRIPTION, true)
    expect(screen.queryByTestId('decision-grid-edit')).toBeNull()
  })

  it('is not offered on a description with no grid', () => {
    row('Just some notes', false)
    expect(screen.queryByTestId('decision-grid-edit')).toBeNull()
  })
})
