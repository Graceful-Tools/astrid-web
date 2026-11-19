/**
 * The board's Done column lists the most recently completed first, whatever the
 * list's sort, and each Done card shows its completed date as a pill under the
 * title (Jon, 2026-11-19; shared with every client and astrid-core PR #93).
 */
import { describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'
import { buildTask, buildTaskList } from '../fixtures/domain'
import { ProjectStatusBoard } from '@/components/project-status-board'
import { formatCompletedOnLabel } from '@/lib/board-done-column'
import type { Task, TaskList } from '@/types/task'

const owner = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as Task['creator']

const projectId = 'project-1'
const status = buildTaskList({ owner, ownerId: owner.id, id: 'ready', name: 'Ready', projectId, listType: 'status' })

function renderBoard(domain: TaskList, tasks: Task[]) {
  return render(
    <ProjectStatusBoard
      allTasks={tasks}
      lists={[domain, status]}
      selectedListId={domain.id}
      currentUser={null}
      onUpdateTask={() => {}}
      onCreateTask={async () => null}
    />,
  )
}

describe("ProjectStatusBoard's Done column", () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000)

  it('orders by completion, newest on top, ignoring the manual order', () => {
    const domain = buildTaskList({
      owner,
      ownerId: owner.id,
      id: 'domain',
      name: 'Domain',
      projectId,
      listType: 'regular',
      sortBy: 'manual',
      manualSortOrder: ['oldest', 'middle', 'newest'] as unknown as TaskList['manualSortOrder'],
    })
    const make = (id: string, completedAt: Date) =>
      buildTask({ creator: owner, creatorId: owner.id, id, title: id, completed: true, completedAt, updatedAt: completedAt, lists: [domain] })
    const tasks = [make('oldest', hoursAgo(5)), make('middle', hoursAgo(3)), make('newest', hoursAgo(1))]

    const { getByTestId } = renderBoard(domain, tasks)
    const done = getByTestId('status-column-done')
    const order = Array.from(done.querySelectorAll('[data-testid^="status-card-"]')).map(card =>
      card.getAttribute('data-testid'),
    )
    expect(order).toEqual(['status-card-newest', 'status-card-middle', 'status-card-oldest'])
  })

  it('shows the completed date as a pill under the title on Done cards only', () => {
    const domain = buildTaskList({ owner, ownerId: owner.id, id: 'domain-2', name: 'Domain', projectId, listType: 'regular' })
    const completedAt = hoursAgo(1)
    const done = buildTask({ creator: owner, creatorId: owner.id, id: 'done-task', title: 'done-task', completed: true, completedAt, lists: [domain] })
    const open = buildTask({ creator: owner, creatorId: owner.id, id: 'open-task', title: 'open-task', completed: false, lists: [domain] })

    const { getByTestId } = renderBoard(domain, [done, open])

    const pill = within(getByTestId('status-card-done-task')).getByTestId('board-card-completed-on')
    const date = formatCompletedOnLabel(completedAt, 'en', new Date())
    // A plain U+2713 check, part of the translated text, says the date is the
    // completion date (Jon, 2026-11-19 follow-up; identical on every client).
    expect(pill.textContent).toBe(`\u2713 on ${date}`)
    // Screen readers and the tooltip get the words, not "check mark".
    expect(pill.getAttribute('aria-label')).toBe(`Completed ${date}`)
    expect(pill.getAttribute('title')).toBe(`Completed ${date}`)
    // Directly under the title: the title's next sibling.
    expect(pill.previousElementSibling?.className).toContain('task-title')
    expect(within(getByTestId('status-card-open-task')).queryByTestId('board-card-completed-on')).toBeNull()
  })
})
