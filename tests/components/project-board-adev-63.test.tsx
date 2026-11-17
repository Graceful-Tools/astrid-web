/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-63 — the boards match the iPhone reference: a card shows its task id,
 * an empty column shows Astrid's empty state, each column header is just a name
 * and a count, a list's row is a header strip over its own board, the project
 * name is not repeated as an h1, and Add list offers New List….
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Task, TaskList } from '@/types/task'

const projects = vi.hoisted(() => [
  { id: 'p1', name: 'Astrid', customStates: [], lists: [{ id: 'web' }] },
])
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => projects),
  peekLoadedProjects: vi.fn(() => projects),
  subscribeLoadedProjects: vi.fn(() => () => {}),
  __clearLoadedProjectsCache: vi.fn(),
}))

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/lib/api', () => api)
vi.mock('@/components/task-row-content', () => ({
  TaskRowContent: ({ task, identifier }: { task: Task; identifier?: string | null }) => (
    <span>{identifier ? `${identifier} ` : ''}{task.title}</span>
  ),
}))

import { ProjectBoard } from '@/components/projects/ProjectBoard'

const list = {
  id: 'web', name: 'Web', color: '#000', ownerId: 'u1', privacy: 'PRIVATE', listType: 'regular',
  projectId: 'p1', createdAt: new Date(), updatedAt: new Date(),
} as TaskList
const doingTask = {
  id: 't1', title: 'Fix it', identifier: 'ADEV-9', completed: false, priority: 0, statusRole: 'doing',
  lists: [list], createdAt: new Date(), updatedAt: new Date(),
} as unknown as Task

function renderBoard(extra: Partial<React.ComponentProps<typeof ProjectBoard>> = {}) {
  return render(
    <ProjectBoard
      projectId="p1"
      projectName="Astrid"
      lists={[list]}
      allTasks={[doingTask]}
      currentUser={{ id: 'u1' } as never}
      onUpdateTask={vi.fn()}
      onCreateTask={vi.fn(async () => null)}
      {...extra}
    />,
  )
}

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiGet.mockResolvedValue({ ok: true, json: async () => ({ listIds: null }) } as Response)
})

describe('ADEV-63 project board', () => {
  it('ADEV-63: a card shows its task id', async () => {
    renderBoard()
    expect(await screen.findByText('ADEV-9 Fix it')).toBeInTheDocument()
  })

  it('ADEV-63: an empty column shows the empty state, not a dashed drop box', async () => {
    renderBoard()
    const ready = await screen.findByTestId('project-board-cell-body-web-ready')
    expect(within(ready).getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.queryByText('Drop tasks here')).toBeNull()
  })

  it('ADEV-63: each column has its own name and count; no icons, no shared header row', async () => {
    renderBoard()
    const header = await screen.findByTestId('project-board-cell-header-web-doing')
    expect(header).toHaveTextContent('Doing')
    expect(header).toHaveTextContent('1')
    expect(header.querySelector('svg')).toBeNull()
    expect(within(await screen.findByTestId('project-board-cell-header-web-__virtual_done__')).queryByRole('img', { hidden: true })).toBeNull()
    expect(screen.queryByTestId('project-board-column-headers')).toBeNull()
    expect(screen.queryByRole('columnheader')).toBeNull()
  })

  it('ADEV-63: the board does not repeat the project name as an h1', async () => {
    renderBoard()
    await screen.findByTestId('project-board-row-web')
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('ADEV-63: Add list is disabled when no row can be added', async () => {
    renderBoard()
    const button = await screen.findByTestId('project-board-add-list')
    expect(button).toBeDisabled()
  })

  it('ADEV-63: Add list offers New List… when the person may create one', async () => {
    api.apiGet.mockResolvedValue({ ok: true, json: async () => ({ listIds: [] }) } as Response)
    const onCreateListInProject = vi.fn()
    renderBoard({ onCreateListInProject })
    const button = await screen.findByTestId('project-board-add-list')
    expect(button).not.toBeDisabled()
    await userEvent.click(button)
    await userEvent.click(await screen.findByTestId('project-board-new-list'))
    const name = await screen.findByTestId('project-board-new-list-name')
    fireEvent.change(name, { target: { value: 'Backend' } })
    fireEvent.submit(name.closest('form')!)
    expect(onCreateListInProject).toHaveBeenCalledWith('Backend', 'p1')
  })
})
