import { describe, expect, it } from 'vitest'
import { buildTask, buildTaskList } from '../fixtures/domain'
import { render } from '@testing-library/react'
import { ProjectStatusBoard } from '@/components/project-status-board'
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

describe('ProjectStatusBoard scrollbar visibility (bug: left slider scrollbar should be hidden)', () => {
  it('the horizontal carousel container has scrollbar-hide', () => {
    const projectId = 'project-1'
    const domain = makeList({ id: 'domain', name: 'Astrid Web', projectId, listType: 'regular' })
    const ready = makeList({
      id: 'ready', name: 'Ready', projectId, listType: 'status',
    })

    const { getByTestId } = render(
      <ProjectStatusBoard
        allTasks={[makeTask({ id: 't1', lists: [domain] })]}
        lists={[domain, ready]}
        selectedListId={domain.id}
        currentUser={null}
        onUpdateTask={() => {}}
        onDeleteTask={() => {}}
        onCreateTask={async () => null}
      />,
    )

    const board = getByTestId('project-status-board')
    expect(board.className).toContain('scrollbar-hide')
  })

  it('every column body scroll container has scrollbar-hide', () => {
    const projectId = 'project-1'
    const domain = makeList({ id: 'domain', name: 'Astrid Web', projectId, listType: 'regular' })
    const ready = makeList({
      id: 'ready', name: 'Ready', projectId, listType: 'status',
    })

    const { getByTestId } = render(
      <ProjectStatusBoard
        allTasks={[makeTask({ id: 't1', lists: [domain] })]}
        lists={[domain, ready]}
        selectedListId={domain.id}
        currentUser={null}
        onUpdateTask={() => {}}
        onDeleteTask={() => {}}
        onCreateTask={async () => null}
      />,
    )

    const board = getByTestId('project-status-board')
    // Every per-column overflow-y-auto element must carry scrollbar-hide.
    const columnBodies = board.querySelectorAll('div.overflow-y-auto')
    expect(columnBodies.length).toBeGreaterThan(0)
    columnBodies.forEach(node => {
      expect((node as HTMLElement).className).toContain('scrollbar-hide')
    })
  })
})
