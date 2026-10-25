/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1302: GET /api/v1/github/projects and POST …/{nodeId}/bind existed, but
 * nothing in the web UI called them, so a GitHub Projects brand had no way to
 * turn an org project into a board. The picker lists installations → projects,
 * binds one, and lands the user on the new board.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const caps = vi.hoisted(() => ({ githubProjects: true }))
vi.mock('@/lib/brand/capabilities', () => ({ CAPABILITIES: caps }))

const apiGet = vi.fn()
const apiPost = vi.fn()
vi.mock('@/lib/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
}))

import { GitHubProjectPickerDialog } from '@/components/github/GitHubProjectPickerDialog'

const PROJECTS = {
  installations: [
    {
      installationId: 11,
      accountLogin: 'acme',
      projects: [
        { nodeId: 'PVT_open', number: 1, title: 'Roadmap', url: 'u1', closed: false, itemCount: 12, updatedAt: '2026-10-01T00:00:00Z', boundProjectId: null, boundListId: null },
        { nodeId: 'PVT_bound', number: 2, title: 'Bugs', url: 'u2', closed: false, itemCount: 3, updatedAt: '2026-10-01T00:00:00Z', boundProjectId: 'proj-bound', boundListId: 'list-bound' },
        { nodeId: 'PVT_closed', number: 3, title: 'Old plan', url: 'u3', closed: true, itemCount: 0, updatedAt: '2026-01-01T00:00:00Z', boundProjectId: null, boundListId: null },
      ],
    },
  ],
}

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

/** lib/api throws ApiError on a non-2xx, carrying status and the body. */
const apiError = (status: number, body: unknown) => Object.assign(new Error(`API call failed: ${status}`), { status, detail: body })

describe('GitHubProjectPickerDialog (AWTD-1302)', () => {
  let navigate: Mock<(path: string) => void>

  beforeEach(() => {
    vi.clearAllMocks()
    navigate = vi.fn()
  })

  function renderPicker() {
    return render(<GitHubProjectPickerDialog open onOpenChange={() => {}} navigate={navigate} />)
  }

  it('lists each installation’s projects, marking bound and closed ones', async () => {
    apiGet.mockResolvedValue(json(PROJECTS))
    renderPicker()

    expect(await screen.findByText('Roadmap')).toBeTruthy()
    expect(screen.getByText('acme')).toBeTruthy()
    expect(apiGet).toHaveBeenCalledWith('/api/v1/github/projects')

    const bound = screen.getByText('Bugs').closest('[data-project-node-id]') as HTMLElement
    expect(bound.textContent).toContain('Open board')

    const closed = screen.getByText('Old plan').closest('[data-project-node-id]') as HTMLElement
    expect(closed.getAttribute('data-closed')).toBe('true')
    expect(closed.className).toContain('opacity')
  })

  it('binds a project and navigates to the new board', async () => {
    apiGet.mockResolvedValue(json(PROJECTS))
    apiPost.mockResolvedValue(json({ projectId: 'p1', listId: 'list-new', importing: true }, 201))
    renderPicker()

    const row = (await screen.findByText('Roadmap')).closest('[data-project-node-id]') as HTMLElement
    fireEvent.click(row.querySelector('button') as HTMLButtonElement)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/lists/list-new'))
    expect(apiPost).toHaveBeenCalledWith('/api/v1/github/projects/PVT_open/bind', { installationId: 11 })
  })

  it('opens an already-bound project’s board without binding again', async () => {
    apiGet.mockResolvedValue(json(PROJECTS))
    renderPicker()
    const row = (await screen.findByText('Bugs')).closest('[data-project-node-id]') as HTMLElement
    fireEvent.click(row.querySelector('button') as HTMLButtonElement)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/lists/list-bound'))
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('offers Connect GitHub when the API says GitHub authorization is needed', async () => {
    apiGet.mockRejectedValue(apiError(403, { error: 'auth_required' }))
    renderPicker()
    const connect = await screen.findByRole('link', { name: /Connect GitHub/ })
    expect(connect.getAttribute('href')).toContain('/api/github/setup?sync=1')
    // …and comes back to the picker.
    expect(decodeURIComponent(connect.getAttribute('href') ?? '')).toContain('connectGithubProject=1')
  })

  it('offers to install the App when no organization is connected', async () => {
    apiGet.mockResolvedValue(json({ installations: [] }))
    renderPicker()
    const install = await screen.findByRole('link', { name: /Install on an organization/ })
    expect(install.getAttribute('href')).toMatch(/\/apps\/.+\/installations\/new$/)
    // And to re-check GitHub, for an org that already has it.
    expect(screen.getByRole('link', { name: /Refresh from GitHub/ }).getAttribute('href')).toContain('/api/github/setup?sync=1')
  })

  it('always offers Install on another org once projects are listed', async () => {
    apiGet.mockResolvedValue(json(PROJECTS))
    renderPicker()
    const another = await screen.findByRole('link', { name: /Install on another org/ })
    expect(another.getAttribute('href')).toMatch(/\/apps\/.+\/installations\/new$/)
  })
})

describe('the add-list modal’s GitHub entry point (AWTD-1302)', () => {
  const user = { id: 'u1', email: 'u@example.com' } as never

  it('offers "Connect a GitHub project" on a GitHub Projects brand, and opens the picker', async () => {
    caps.githubProjects = true
    apiGet.mockResolvedValue(json(PROJECTS))
    const { AddListModal } = await import('@/components/add-list-modal')
    render(<AddListModal onClose={() => {}} onCreateList={() => {}} currentUser={user} />)
    fireEvent.click(screen.getByRole('button', { name: /Connect a GitHub project/ }))
    expect(await screen.findByText('Roadmap')).toBeTruthy()
  })

  it('does not offer it elsewhere', async () => {
    caps.githubProjects = false
    const { AddListModal } = await import('@/components/add-list-modal')
    render(<AddListModal onClose={() => {}} onCreateList={() => {}} currentUser={user} />)
    expect(screen.queryByRole('button', { name: /Connect a GitHub project/ })).toBeNull()
    caps.githubProjects = true
  })
})
