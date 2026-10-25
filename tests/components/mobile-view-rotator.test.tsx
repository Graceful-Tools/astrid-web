/**
 * AWTD-1183 — "UX consistency: list chat / messages panel".
 *
 * Jon's decision: web in one column matches the iPhone app. The iPhone header
 * carries ONE icon that steps through the views (list → messages → board);
 * web showed a three-button List / Board / Messages strip instead.
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskViewToggle } from '@/components/TaskManager/Header/TaskViewToggle'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

const base = {
  isOneColumn: true,
  hasProjectBoard: true,
  chatAvailable: true,
  activeView: 'list' as const,
  isSearching: false,
  activePanel: 'tasks' as const,
  taskViewMode: 'list' as const,
}

function renderToggle(overrides: Partial<React.ComponentProps<typeof TaskViewToggle>> = {}) {
  const onTaskViewModeChange = vi.fn()
  const onToggleActivePanel = vi.fn()
  render(
    <TaskViewToggle
      {...base}
      onTaskViewModeChange={onTaskViewModeChange}
      onToggleActivePanel={onToggleActivePanel}
      {...overrides}
    />,
  )
  return { onTaskViewModeChange, onToggleActivePanel }
}

describe('one-column header view rotator (AWTD-1183)', () => {
  it('is a single icon button, not a strip of segments', () => {
    renderToggle()
    expect(screen.getByTestId('header-view-rotator')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByTestId('header-unified-toggle')).not.toBeInTheDocument()
  })

  it('names the view the next tap opens', () => {
    renderToggle()
    const rotator = screen.getByTestId('header-view-rotator')
    expect(rotator).toHaveAttribute('data-current', 'list')
    expect(rotator).toHaveAttribute('data-next', 'messages')
    expect(rotator).toHaveAttribute('aria-label', 'viewRotator.showMessages')
  })

  it('list → messages opens the chat panel', () => {
    const { onToggleActivePanel, onTaskViewModeChange } = renderToggle()
    fireEvent.click(screen.getByTestId('header-view-rotator'))
    expect(onToggleActivePanel).toHaveBeenCalledWith('chat')
    expect(onTaskViewModeChange).not.toHaveBeenCalled()
  })

  it('messages → board leaves chat and switches to the board', () => {
    const { onToggleActivePanel, onTaskViewModeChange } = renderToggle({ activePanel: 'chat' })
    const rotator = screen.getByTestId('header-view-rotator')
    expect(rotator).toHaveAttribute('data-next', 'board')
    fireEvent.click(rotator)
    expect(onToggleActivePanel).toHaveBeenCalledWith('tasks')
    expect(onTaskViewModeChange).toHaveBeenCalledWith('board')
  })

  it('board → list wraps around', () => {
    const { onToggleActivePanel, onTaskViewModeChange } = renderToggle({ taskViewMode: 'board' })
    const rotator = screen.getByTestId('header-view-rotator')
    expect(rotator).toHaveAttribute('data-next', 'list')
    fireEvent.click(rotator)
    expect(onTaskViewModeChange).toHaveBeenCalledWith('list')
    expect(onToggleActivePanel).not.toHaveBeenCalled()
  })

  it('with no board it flips between list and messages', () => {
    const { onToggleActivePanel, onTaskViewModeChange } = renderToggle({
      hasProjectBoard: false,
      activePanel: 'chat',
    })
    const rotator = screen.getByTestId('header-view-rotator')
    expect(rotator).toHaveAttribute('data-next', 'list')
    fireEvent.click(rotator)
    expect(onToggleActivePanel).toHaveBeenCalledWith('tasks')
    expect(onTaskViewModeChange).not.toHaveBeenCalled()
  })

  it('leaves the wider List/Board control alone', () => {
    renderToggle({ isOneColumn: false })
    expect(screen.getByTestId('header-list-board-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('header-view-rotator')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
