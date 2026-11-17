/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-4 — the project board's design: "Rows should be same height. Columns
 * should snap in mobile web view."
 *
 *   - Every swimlane row has the same fixed height whatever its cards, and each
 *     cell scrolls its own cards inside it (the list board's columns do the
 *     same), so a busy list cannot stretch its row.
 *   - One-column (mobile) mode makes the board a snap carousel with the list
 *     board's own classes: every column header and cell is scroller-wide and
 *     snaps to its start, and each cell names its row's list, since a
 *     scroller-wide cell leaves no room for the row-header column.
 *
 * jsdom draws nothing, so these pin the classes; the heights themselves were
 * measured in a browser (see the ADEV-4 PR).
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
vi.mock('@/components/task-row-content', () => ({
  TaskRowContent: ({ task }: { task: Task }) => <span>{task.title}</span>,
}))

import { ProjectBoard } from '@/components/projects/ProjectBoard'

function list(id: string, name: string): TaskList {
  return {
    id, name, color: '#000', ownerId: 'u1', privacy: 'PRIVATE', listType: 'regular',
    projectId: 'p1', createdAt: new Date(), updatedAt: new Date(),
  } as TaskList
}
const lists = [list('web', 'Web'), list('ios', 'iOS')]

function task(id: string, listId: string, statusRole: string | null): Task {
  return {
    id, title: `Task ${id}`, completed: false, priority: 0, statusRole,
    lists: [lists.find(l => l.id === listId)!], createdAt: new Date(), updatedAt: new Date(),
  } as unknown as Task
}

// Web is busy (six cards in Doing); iOS has one card. Their rows must still match.
const tasks = [
  ...Array.from({ length: 6 }, (_, i) => task(`w${i}`, 'web', 'doing')),
  task('i0', 'ios', null),
]

function renderBoard(isOneColumn = false) {
  return render(
    <ProjectBoard
      projectId="p1"
      projectName="Astrid"
      lists={lists}
      allTasks={tasks}
      currentUser={{ id: 'u1' } as never}
      onUpdateTask={vi.fn()}
      onCreateTask={vi.fn(async () => null)}
      isOneColumn={isOneColumn}
    />,
  )
}

const classesOf = (element: HTMLElement) => element.className.split(/\s+/)

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiGet.mockResolvedValue({ ok: true, json: async () => ({ listIds: null }) } as Response)
})

describe('ADEV-4 project board design', () => {
  it('ADEV-4: every row has the same fixed height, and each cell scrolls its own cards', async () => {
    renderBoard()
    const web = await screen.findByTestId('project-board-row-web')
    const ios = screen.getByTestId('project-board-row-ios')

    // ADEV-63: the row is a header strip plus the list's own board, and the
    // fixed height is on each column's card area, not on the row.
    expect(classesOf(web)).not.toContain('h-80')
    expect(classesOf(ios)).not.toContain('h-80')

    for (const cell of [screen.getByTestId('project-board-cell-web-doing'), screen.getByTestId('project-board-cell-ios-doing')]) {
      expect(classesOf(cell)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0']))
      const body = cell.querySelector('[data-testid^="project-board-cell-body-"]') as HTMLElement
      expect(body).not.toBeNull()
      expect(classesOf(body)).toEqual(expect.arrayContaining(['h-64', 'overflow-y-auto']))
    }
  })

  it('ADEV-4: on mobile the columns snap, one scroller-wide column at a time', async () => {
    renderBoard(true)
    await screen.findByTestId('project-board-row-web')

    const scroller = screen.getByTestId('project-board-scroller')
    expect(classesOf(scroller)).toEqual(expect.arrayContaining(['snap-x', 'snap-mandatory', 'scroll-px-4', 'overscroll-x-contain']))

    const snappers = [
      screen.getByTestId('project-board-cell-web-doing'),
      screen.getByTestId('project-board-cell-ios-__virtual_inbox__'),
    ]
    for (const element of snappers) {
      expect(classesOf(element)).toEqual(expect.arrayContaining(['snap-start', 'w-full', 'shrink-0']))
    }

    // No room for the row-header column, so each cell names its list instead.
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0)
    expect(screen.getByTestId('project-board-cell-ios-doing')).toHaveTextContent('iOS')
    expect(screen.getAllByTestId('project-board-remove-web').length).toBeGreaterThan(0)
  })

  it('ADEV-4: on desktop the board does not snap and keeps the row-header column', async () => {
    renderBoard(false)
    await screen.findByTestId('project-board-row-web')
    expect(classesOf(screen.getByTestId('project-board-scroller'))).not.toContain('snap-mandatory')
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)
  })
})
