/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-63 — the list board's columns match the iPhone reference: the header is
 * the name and count with no check or inbox icon, an empty column shows
 * Astrid's empty state, and the add bar is the full quick-add (checkbox with
 * the priority/assignee picker, "Add a task"); Done has none.
 */
import { describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'
import { buildTaskList } from '../fixtures/domain'
import { ProjectStatusBoard } from '@/components/project-status-board'

describe('ADEV-63 list board columns', () => {
  const domain = buildTaskList({ id: 'domain', name: 'Astrid Web', projectId: 'project-1', listType: 'regular' })
  const board = () =>
    render(
      <ProjectStatusBoard
        allTasks={[]}
        lists={[domain]}
        selectedListId={domain.id}
        currentUser={null}
        onUpdateTask={() => {}}
        onCreateTask={async () => null}
      />,
    )

  it('ADEV-63: Done and Inbox headers carry no icon', () => {
    const { getByTestId } = board()
    for (const id of ['status-column-done', 'status-column-inbox']) {
      const header = getByTestId(id).firstElementChild as HTMLElement
      expect(header.querySelector('svg')).toBeNull()
    }
  })

  it('ADEV-63: an empty column shows the empty state, not a dashed drop box', () => {
    const { getByTestId, queryByText } = board()
    expect(within(getByTestId('status-column-inbox')).getByTestId('empty-state')).toBeTruthy()
    expect(queryByText('Drop tasks here')).toBeNull()
  })

  it('ADEV-63: the add bar is the full quick-add, and Done has none', () => {
    const { getByTestId, queryByTestId } = board()
    const add = getByTestId('status-add-__virtual_inbox__')
    expect(within(add).getByRole('textbox').getAttribute('placeholder')).toBe('Add a task')
    expect(within(add).getByRole('button', { name: /priority|assignee/i })).toBeTruthy()
    expect(queryByTestId('status-add-__virtual_done__')).toBeNull()
  })
})
