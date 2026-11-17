/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-53 — the project board's cosmetic fixes. jsdom draws nothing, so these
 * pin the classes that carry each fix:
 *   1. the row header's title sits on its own line, under the list image;
 *   2. the column counts are larger than text-xs;
 *   3. the sticky column header sits flush with the top of the scroller, so no
 *      card scrolls behind a gap above it.
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
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ taskDisplayMode: 'list' }) }))
vi.mock('@/components/task-row-content', () => ({
  TaskRowContent: ({ task }: { task: Task }) => <span>{task.title}</span>,
}))

import { ProjectBoard } from '@/components/projects/ProjectBoard'

const web = {
  id: 'web', name: 'Web', color: '#000', ownerId: 'u1', privacy: 'PRIVATE', listType: 'regular',
  projectId: 'p1', imageUrl: 'https://example.com/web.png', createdAt: new Date(), updatedAt: new Date(),
} as TaskList

const classesOf = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/)

function renderBoard() {
  return render(
    <ProjectBoard
      projectId="p1"
      projectName="Astrid"
      lists={[web]}
      allTasks={[] as Task[]}
      currentUser={{ id: 'u1' } as never}
      onUpdateTask={vi.fn()}
      onCreateTask={vi.fn(async () => null)}
    />,
  )
}

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiGet.mockResolvedValue({ ok: true, json: async () => ({ listIds: null }) } as Response)
})

describe('ADEV-53 project board cosmetics', () => {
  it('ADEV-53: the row title is on its own line, not inline with the image', async () => {
    renderBoard()
    await screen.findByTestId('project-board-row-web')
    const title = screen.getByText('Web', { selector: 'div' })
    expect(classesOf(title.parentElement!)).toContain('flex-col')
  })

  it('ADEV-53: the column counts are larger than text-xs', async () => {
    renderBoard()
    const counts = await screen.findByTestId('project-board-counts-web')
    expect(classesOf(counts)).not.toContain('text-xs')
    expect(classesOf(counts)).toContain('text-sm')
  })

  it('ADEV-53: the sticky column header leaves no gap above it', async () => {
    renderBoard()
    await screen.findByTestId('project-board-row-web')
    const scroller = screen.getByTestId('project-board-scroller')
    expect(classesOf(scroller)).toContain('pt-0')
    const header = screen.getByTestId('project-board-column-headers')
    expect(classesOf(header)).not.toContain('-mt-4')
  })
})
