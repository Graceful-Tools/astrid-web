/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1582 — the board-status pill sits on the LIST row's metadata line, after
 * the due date and before the list chips, and never on a board card.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import type { Task } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

import { TaskRowContent } from '@/components/task-row-content'

const dated = {
  id: 't1',
  title: 'Row task',
  completed: false,
  priority: 0,
  repeating: 'never',
  dueDateTime: '2026-03-04T17:30:00.000Z',
  isAllDay: false,
  lists: [{ id: 'l1', name: 'Groceries', color: '#4287f5' }],
} as unknown as Task

describe('TaskRowContent board-status pill (AWTD-1582)', () => {
  it('AWTD-1582: draws the localized column name in its colour class', () => {
    render(
      <TaskRowContent task={dated} boardStatus={{ kind: 'waiting', boardName: null }} onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />,
    )
    const pill = screen.getByTestId('task-row-board-status-waiting')
    expect(pill.textContent).toBe('Waiting')
    expect(pill.className).toContain('board-status-waiting')
  })

  it("AWTD-1582: a board's own name wins over the built-in one", () => {
    render(
      <TaskRowContent task={dated} boardStatus={{ kind: 'ready', boardName: 'Up next' }} onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />,
    )
    expect(screen.getByTestId('task-row-board-status-ready').textContent).toBe('Up next')
  })

  it('AWTD-1582: sits after the due date and before the list chips', () => {
    const { container } = render(
      <TaskRowContent task={dated} boardStatus={{ kind: 'inbox', boardName: null }} onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />,
    )
    const pill = screen.getByTestId('task-row-board-status-inbox')
    const date = [...container.querySelectorAll('div')].find(node => /2026|Mar|\d:\d\d/.test(node.textContent ?? '') && node.children.length === 0)!
    const chip = screen.getByText('Groceries')
    expect(date).toBeTruthy()
    expect(date.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pill.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('AWTD-1582: brings the metadata line into existence on its own', () => {
    const bare = { ...dated, dueDateTime: null, lists: [] } as unknown as Task
    render(<TaskRowContent task={bare} boardStatus={{ kind: 'done', boardName: null }} onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.getByTestId('task-row-board-status-done').textContent).toBe('Done')
  })

  it('AWTD-1582: no pill when none is handed', () => {
    render(<TaskRowContent task={dated} onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.queryByTestId(/task-row-board-status/)).toBeNull()
  })

  it('AWTD-1582: a board card never passes one', () => {
    const board = readFileSync(join(process.cwd(), 'components/project-status-board.tsx'), 'utf8')
    expect(board).not.toMatch(/boardStatus=/)
  })
})
