import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ProjectStatusBoard } from '@/components/project-status-board'
import type { Task, TaskList } from '@/types/task'

const owner = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as Task['creator']

function makeList(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return {
    id: overrides.id,
    name: overrides.name,
    privacy: 'PRIVATE',
    owner,
    ownerId: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lists: [],
    ...overrides,
  } as unknown as TaskList
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    description: '',
    creator: owner,
    creatorId: 'user-1',
    priority: 0,
    lists: overrides.lists ?? [],
    isPrivate: false,
    completed: false,
    attachments: [],
    comments: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    repeating: 'never',
    repeatFrom: 'COMPLETION_DATE',
    occurrenceCount: 0,
    ...overrides,
  } as Task
}

describe('ProjectStatusBoard scrollbar visibility (bug: left slider scrollbar should be hidden)', () => {
  it('the horizontal carousel container has scrollbar-hide', () => {
    const projectId = 'project-1'
    const domain = makeList({ id: 'domain', name: 'Astrid Web', projectId, listType: 'regular' })
    const ready = makeList({
      id: 'ready', name: 'Ready', projectId, listType: 'status',
      statusRole: 'ready', statusOrder: 0,
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
      statusRole: 'ready', statusOrder: 0,
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
