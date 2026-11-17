/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-85 — each empty board column speaks to its own state (iOS ADEV-81
 * parity), word for word, instead of the list's generic empty message.
 */
import { describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'
import { buildTaskList } from '../fixtures/domain'
import { ProjectStatusBoard } from '@/components/project-status-board'
import { boardColumnEmptyKey } from '@/lib/board-column-labels'

describe('ADEV-85 per-column empty messages', () => {
  const domain = buildTaskList({ id: 'domain', name: 'Astrid Web', projectId: 'project-1', listType: 'regular' })

  it('ADEV-85: each column shows its own message', () => {
    const { getByTestId } = render(
      <ProjectStatusBoard
        allTasks={[]}
        lists={[domain]}
        selectedListId={domain.id}
        currentUser={null}
        onUpdateTask={() => {}}
        onCreateTask={async () => null}
      />,
    )
    const expected: Record<string, string> = {
      'status-column-inbox': 'Nothing new to sort! Tasks without a status land here.',
      'status-column-ready': "Nothing queued up! Move a task here when it's ready to start.",
      'status-column-doing': 'Nothing in progress. Pick something from Ready and get going!',
      'status-column-waiting': 'Nothing on hold! Tasks waiting on a date or another task show up here.',
      'status-column-done': 'No finished tasks yet. Complete one and celebrate it here!',
    }
    for (const [id, text] of Object.entries(expected)) {
      expect(within(getByTestId(id)).getByTestId('empty-state').textContent).toContain(text)
    }
  })

  it('ADEV-85: a custom column gets the generic message', () => {
    expect(boardColumnEmptyKey({ id: 'custom-1', kind: 'status' })).toBe('board.empty.custom')
    expect(boardColumnEmptyKey({ id: 'ready', kind: 'status' })).toBe('board.empty.ready')
  })
})
