import { describe, expect, it } from 'vitest'
import { buildTask, buildTaskList } from '../fixtures/domain'
import { render } from '@testing-library/react'
import { ProjectStatusBoard } from '@/components/project-status-board'
import { VIRTUAL_DONE_COLUMN_ID } from '@/lib/project-status'
import type { Task, TaskList } from '@/types/task'

const owner = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as Task['creator']

// Rebuilt on tests/fixtures/domain (AWTD-916). The literal these replace
// passed `id`/`name` through twice, carried fields the app-facing types do not
// have, and was held together by `as unknown as` — which is what let all of
// that through.
function makeList(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return buildTaskList({ owner, ownerId: owner.id, ...overrides })
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  // `title` falls back to the id, as this helper always has — the assertions
  // below look the card up by its id text.
  return buildTask({ creator: owner, creatorId: owner.id, title: overrides.id, ...overrides })
}

describe("ProjectStatusBoard's Done column honors the list's Recently Completed window", () => {
  const projectId = 'project-1'
  const status = makeList({ id: 'ready', name: 'Ready', projectId, listType: 'status'})
  const oldCompleted = makeTask({ id: 'old-done', completed: true, updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) })
  const recentCompleted = makeTask({ id: 'recent-done', completed: true, updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })

  it('with default window (null), only completed-within-24h shows in Done', () => {
    const domain = makeList({ id: 'domain', name: 'Astrid Web', projectId, listType: 'regular' })
    // Attach both tasks to the domain list so they're in scope
    const tasks = [
      makeTask({ ...oldCompleted, lists: [domain] }),
      makeTask({ ...recentCompleted, lists: [domain] }),
    ]

    const { getByTestId, queryByText } = render(
      <ProjectStatusBoard
        allTasks={tasks}
        lists={[domain, status]}
        selectedListId={domain.id}
        currentUser={null}
        onUpdateTask={() => {}}
        onDeleteTask={() => {}}
        onCreateTask={async () => null}
      />,
    )

    const doneColumn = getByTestId('status-column-done')
    expect(doneColumn).toBeTruthy()
    // The recent one is visible
    expect(doneColumn.textContent).toContain('recent-done')
    // The 10-day-old one is NOT visible under the default 24h window
    expect(doneColumn.textContent).not.toContain('old-done')
    // Sanity: column id is the virtual Done id
    expect(doneColumn.getAttribute('data-testid')).toBe('status-column-done')
    expect(doneColumn.getAttribute('data-column-index')).not.toBeNull()
    expect(VIRTUAL_DONE_COLUMN_ID.length).toBeGreaterThan(0)
    expect(queryByText('old-done')).toBeNull()
  })

  it('with a 14-day window, the 10-day-old completed task shows in Done', () => {
    const domain = makeList({
      id: 'domain-14d',
      name: 'Astrid Web (14d)',
      projectId,
      listType: 'regular',
      recentlyCompletedWindow: { kind: 'duration', amount: 14, unit: 'day' } as unknown,
    })
    const tasks = [
      makeTask({ ...oldCompleted, lists: [domain] }),
      makeTask({ ...recentCompleted, lists: [domain] }),
    ]

    const { getByTestId } = render(
      <ProjectStatusBoard
        allTasks={tasks}
        lists={[domain, status]}
        selectedListId={domain.id}
        currentUser={null}
        onUpdateTask={() => {}}
        onDeleteTask={() => {}}
        onCreateTask={async () => null}
      />,
    )

    const doneColumn = getByTestId('status-column-done')
    expect(doneColumn.textContent).toContain('recent-done')
    expect(doneColumn.textContent).toContain('old-done')
  })
})
