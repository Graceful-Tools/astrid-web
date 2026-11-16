/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-22 — the project board's layout: a thinner row-header column whose list
 * title wraps, the list's image and colour on the row header, a card count in
 * every column header, and column headers that stay stuck on long boards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Task, TaskList } from '@/types/task'

const projects = vi.hoisted(() => [
  { id: 'p1', name: 'Astrid', customStates: [], lists: [{ id: 'web' }, { id: 'ios' }] },
])
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => projects),
  peekLoadedProjects: vi.fn(() => projects),
  subscribeLoadedProjects: vi.fn(() => () => {}),
  __clearLoadedProjectsCache: vi.fn(),
}))

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/lib/api', () => api)
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ taskDisplayMode: 'list' }) }))
vi.mock('@/components/task-row-content', () => ({
  TaskRowContent: ({ task }: { task: Task }) => <span>{task.title}</span>,
}))

import { ProjectBoard } from '@/components/projects/ProjectBoard'

function list(id: string, name: string, extra: Partial<TaskList> = {}): TaskList {
  return {
    id, name, color: '#123456', ownerId: 'u1', privacy: 'PRIVATE', listType: 'regular',
    projectId: 'p1', createdAt: new Date(), updatedAt: new Date(), ...extra,
  } as TaskList
}
const lists = [
  list('web', 'A very long list title that must wrap', { imageUrl: 'https://example.com/web.png' }),
  list('ios', 'iOS'),
]

function task(id: string, listId: string, statusRole: string | null): Task {
  return {
    id, title: `Task ${id}`, completed: false, priority: 0, statusRole,
    lists: [lists.find(l => l.id === listId)!], createdAt: new Date(), updatedAt: new Date(),
  } as unknown as Task
}

const tasks = [task('w0', 'web', 'doing'), task('w1', 'web', 'doing'), task('i0', 'ios', 'doing'), task('i1', 'ios', null)]

const classesOf = (element: HTMLElement) => element.className.split(/\s+/)

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiGet.mockResolvedValue({ ok: true, json: async () => ({ listIds: null }) } as Response)
})

function renderBoard() {
  return render(
    <ProjectBoard
      projectId="p1"
      projectName="Astrid"
      lists={lists}
      allTasks={tasks}
      currentUser={{ id: 'u1' } as never}
      onUpdateTask={vi.fn()}
      onCreateTask={vi.fn(async () => null)}
    />,
  )
}

describe('ADEV-22 project board layout', () => {
  it('ADEV-22: the row header is thin and wraps the list title', async () => {
    renderBoard()
    const header = (await screen.findAllByRole('rowheader'))[0]
    expect(classesOf(header)).toContain('w-32')
    const title = screen.getByText('A very long list title that must wrap')
    expect(classesOf(title)).not.toContain('truncate')
    expect(classesOf(title)).toContain('break-words')
  })

  it('ADEV-22: the row header shows the list image and is outlined in the list colour', async () => {
    renderBoard()
    const header = (await screen.findAllByRole('rowheader'))[0]
    expect(header.style.borderColor).not.toBe('')
    expect(screen.getByTestId('project-board-row-image-web')).toHaveAttribute('src', 'https://example.com/web.png')
    expect(screen.queryByTestId('project-board-row-image-ios')).toBeNull()
  })

  it('ADEV-22: every column header counts its cards across the rows', async () => {
    renderBoard()
    await screen.findByTestId('project-board-row-web')
    expect(screen.getByTestId('project-board-count-doing')).toHaveTextContent('3')
    expect(screen.getByTestId('project-board-count-__virtual_inbox__')).toHaveTextContent('1')
  })

  it('ADEV-22: the column headers stay sticky', async () => {
    renderBoard()
    const headerRow = await screen.findByTestId('project-board-header-row')
    expect(classesOf(headerRow)).toEqual(expect.arrayContaining(['sticky', 'top-0']))
  })
})
