/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-54 — "I cannot see a way to edit project settings."
 * The board header offers Project settings to the owner or a project admin,
 * and its dialog renames the project through PATCH /api/v1/projects/:id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mayAdministerProject } from '@/lib/list-project-moves'

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn() }))
vi.mock('@/lib/api', () => api)
const renameLoadedProject = vi.hoisted(() => vi.fn())
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => []),
  peekLoadedProjects: vi.fn(() => []),
  subscribeLoadedProjects: vi.fn(() => () => {}),
  renameLoadedProject,
}))

import { ProjectBoard } from '@/components/projects/ProjectBoard'

const renderBoard = (canEditSettings: boolean) =>
  render(
    <ProjectBoard
      projectId="p1"
      projectName="Astrid"
      canEditSettings={canEditSettings}
      lists={[]}
      allTasks={[]}
      onUpdateTask={() => {}}
      onCreateTask={async () => null}
    />,
  )

describe('ADEV-54 project settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.apiGet.mockResolvedValue({ json: async () => ({ listIds: [] }) })
    api.apiPatch.mockResolvedValue({ ok: true })
  })

  it('ADEV-54: only an owner or project admin may open project settings', () => {
    const project = { id: 'p1', ownerId: 'o', members: [{ userId: 'a', role: 'admin' }, { userId: 'm', role: 'member' }] }
    expect(mayAdministerProject('o', project)).toBe(true)
    expect(mayAdministerProject('a', project)).toBe(true)
    expect(mayAdministerProject('m', project)).toBe(false)
    expect(mayAdministerProject('', project)).toBe(false)
  })

  it('ADEV-54: the board header has no settings button without permission', () => {
    renderBoard(false)
    expect(screen.queryByTestId('project-board-settings')).toBeNull()
  })

  it('ADEV-54: renaming from the board header saves the name and updates the cache', async () => {
    renderBoard(true)
    fireEvent.click(screen.getByTestId('project-board-settings'))
    fireEvent.change(screen.getByTestId('project-settings-name'), { target: { value: '  Orbit ' } })
    fireEvent.click(screen.getByTestId('project-settings-save'))
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledWith('/api/v1/projects/p1', { name: 'Orbit' }))
    expect(renameLoadedProject).toHaveBeenCalledWith('p1', 'Orbit')
  })

  it('ADEV-54: a failed save keeps the dialog open and says so', async () => {
    api.apiPatch.mockRejectedValue(new Error('403'))
    renderBoard(true)
    fireEvent.click(screen.getByTestId('project-board-settings'))
    fireEvent.change(screen.getByTestId('project-settings-name'), { target: { value: 'Orbit' } })
    fireEvent.click(screen.getByTestId('project-settings-save'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(renameLoadedProject).not.toHaveBeenCalled()
  })
})
