/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-361 — Settings > Projects. The hub offers the tab only with Project Mode on, and the page
 * draws Edit for an owner or project admin and Delete for the owner alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mode = vi.hoisted(() => ({ on: true }))
vi.mock('@/hooks/use-project-mode', () => ({ useProjectMode: () => mode.on }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me' } } }),
  signOut: vi.fn(),
}))
const projects = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('@/hooks/use-loaded-projects', () => ({ useLoadedProjects: () => projects.list }))
vi.mock('@/lib/api', () => ({ apiCall: vi.fn(), apiPost: vi.fn(), apiGet: vi.fn(), apiPatch: vi.fn(), apiPut: vi.fn(), refusalReason: () => null }))
vi.mock('@/components/projects/ProjectSettingsDialog', () => ({ ProjectSettingsDialog: () => null }))

import SettingsHub from '@/components/Settings/SettingsHub'
import ProjectsSettings from '@/components/Settings/ProjectsSettings'

describe('ADEV-361 Settings Projects tab', () => {
  beforeEach(() => {
    mode.on = true
    projects.list = [
      { id: 'owned', name: 'Mine', ownerId: 'me', members: [] },
      { id: 'admin', name: 'Admin', ownerId: 'x', members: [{ userId: 'me', role: 'admin' }] },
      { id: 'member', name: 'Member', ownerId: 'x', members: [{ userId: 'me', role: 'member' }] },
    ]
  })

  it('ADEV-361: the hub shows the Projects tab only with Project Mode on', () => {
    const { container, rerender } = render(<SettingsHub onNavigate={() => {}} />)
    expect(container.querySelector('[data-settings-page="projects"]')).not.toBeNull()
    mode.on = false
    rerender(<SettingsHub onNavigate={() => {}} />)
    expect(container.querySelector('[data-settings-page="projects"]')).toBeNull()
  })

  it('ADEV-361: the page draws nothing with Project Mode off', () => {
    mode.on = false
    render(<ProjectsSettings onNavigate={() => {}} />)
    expect(screen.queryByTestId('projects-settings')).toBeNull()
  })

  it('ADEV-361: edit is for owner or admin, delete for the owner only', () => {
    render(<ProjectsSettings onNavigate={() => {}} />)
    expect(screen.getByTestId('projects-settings-edit-owned')).toBeTruthy()
    expect(screen.getByTestId('projects-settings-delete-owned')).toBeTruthy()
    expect(screen.getByTestId('projects-settings-edit-admin')).toBeTruthy()
    expect(screen.queryByTestId('projects-settings-delete-admin')).toBeNull()
    expect(screen.queryByTestId('projects-settings-edit-member')).toBeNull()
    expect(screen.queryByTestId('projects-settings-delete-member')).toBeNull()
  })
})
