/**
 * AWTD-1629 — on a narrow viewport, tapping the description opens the
 * full-screen reader already in edit mode; the expand button reads it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskDetailDescriptionRow } from '@/components/task-detail/TaskDetailDescriptionRow'
import type { Task } from '@/types/task'

function setNarrow(narrow: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function renderRow(overrides: { readOnly?: boolean; description?: string } = {}) {
  const onSaveFullScreen = vi.fn()
  const setEditingDescription = vi.fn()
  render(
    <TaskDetailDescriptionRow
      task={{ id: 't1', description: overrides.description ?? 'Existing text' } as unknown as Task}
      readOnly={overrides.readOnly ?? false}
      editingDescription={false}
      setEditingDescription={setEditingDescription}
      tempDescription=""
      setTempDescription={vi.fn()}
      descriptionRef={{ current: null }}
      descriptionTextareaRef={{ current: null }}
      handleSaveDescription={onSaveFullScreen}
      handleCancelDescription={vi.fn()}
    />
  )
  return { onSaveFullScreen, setEditingDescription }
}

describe('task description full-screen reader (AWTD-1629)', () => {
  beforeEach(() => setNarrow(true))

  it('tapping the description on mobile opens the reader in edit mode', () => {
    const { setEditingDescription } = renderRow()
    fireEvent.click(screen.getByText('Existing text'))
    expect(setEditingDescription).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-description-reader')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Existing text')
  })

  it('Done saves changed text, and clearing counts as a change', () => {
    const { onSaveFullScreen } = renderRow()
    fireEvent.click(screen.getByText('Existing text'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onSaveFullScreen).toHaveBeenCalledWith('')
  })

  it('Done with no change does not save', () => {
    const { onSaveFullScreen } = renderRow()
    fireEvent.click(screen.getByText('Existing text'))
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onSaveFullScreen).not.toHaveBeenCalled()
  })

  it('the expand button reads a written description', () => {
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /expand description/i }))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('a read-only task never opens an editor', () => {
    renderRow({ readOnly: true })
    fireEvent.click(screen.getByText('Existing text'))
    expect(screen.queryByTestId('task-description-reader')).toBeNull()
  })

  it('on a wide viewport the inline editor is used', () => {
    setNarrow(false)
    const { setEditingDescription } = renderRow()
    fireEvent.click(screen.getByText('Existing text'))
    expect(setEditingDescription).toHaveBeenCalledWith(true)
    expect(screen.queryByTestId('task-description-reader')).toBeNull()
  })
})
