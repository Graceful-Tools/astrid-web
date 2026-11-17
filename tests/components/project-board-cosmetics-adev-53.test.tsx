/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-53 — the project board's cosmetics: the row header's list name sits on
 * its own line below the image, the per-column counts are larger, and the
 * sticky column header sits flush under the board's title bar so nothing
 * scrolls behind a gap above it. jsdom draws nothing, so these pin the classes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  TaskRowContent: ({ task }: { task: Task }) => <span>{task.title}</span>,
}))

import { ProjectBoard } from '@/components/projects/ProjectBoard'

const lists = [
  {
    id: 'web', name: 'Web', color: '#000', imageUrl: 'https://example.com/i.png', ownerId: 'u1',
    privacy: 'PRIVATE', listType: 'regular', projectId: 'p1', createdAt: new Date(), updatedAt: new Date(),
  } as TaskList,
]

function renderBoard() {
  return render(
    <ProjectBoard
      projectId="p1"
      projectName="Astrid"
      lists={lists}
      allTasks={[] as Task[]}
      currentUser={{ id: 'u1' } as never}
      onUpdateTask={vi.fn()}
      onCreateTask={vi.fn(async () => null)}
    />,
  )
}

const classesOf = (element: HTMLElement) => element.className.split(/\s+/)

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiGet.mockResolvedValue({ ok: true, json: async () => ({ listIds: null }) } as Response)
})

describe('ADEV-53 project board cosmetics', () => {
  it('ADEV-53: the list name sits on its own line, below the image', async () => {
    renderBoard()
    const row = await screen.findByTestId('project-board-row-web')
    const header = row.querySelector('[role="rowheader"]') as HTMLElement
    const img = header.querySelector('img') as HTMLElement
    const name = Array.from(header.querySelectorAll('div')).find(
      el => el.textContent === 'Web' && el.children.length === 0,
    ) as HTMLElement
    expect(img.parentElement).toBe(name.parentElement)
    expect(classesOf(name.parentElement as HTMLElement)).toContain('flex-col')
  })

  it('ADEV-53: the per-column counts are larger than text-xs', async () => {
    renderBoard()
    const counts = await screen.findByTestId('project-board-counts-web')
    expect(classesOf(counts)).toContain('text-sm')
    expect(classesOf(counts)).not.toContain('text-xs')
  })

  it('ADEV-53: the sticky column header leaves no gap above it', async () => {
    renderBoard()
    const headers = await screen.findByTestId('project-board-column-headers')
    const scroller = screen.getByTestId('project-board-scroller')
    expect(classesOf(scroller)).toContain('pt-0')
    expect(classesOf(headers)).not.toContain('-mt-4')
    expect(classesOf(headers)).toContain('top-0')
  })
})
