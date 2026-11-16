/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1703 — the list settings "Project" control. It offers exactly the destinations the
 * core's listProjectMoves rule allows (lib/list-project-moves.ts, held to the core fixture by
 * tests/lib/list-project-moves-awtd-1703.test.ts), a move is one PUT, and a refusal leaves the
 * list where it was and shows the server's reason.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { TaskList } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

const fetchProjects = vi.hoisted(() => vi.fn())
vi.mock('@/lib/client-projects', () => ({ fetchProjects }))

const apiCall = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiCall,
}))

import { ApiError } from '@/lib/api'
import { BoardViewSection } from '@/components/list-admin/BoardViewSection'

const PROJECTS = [
  { id: 'mine', name: 'Alpha', key: 'ALP', ownerId: 'me', members: [] },
  { id: 'run', name: 'Beta', key: 'BET', ownerId: 'boss', members: [{ userId: 'me', role: 'admin' }] },
  { id: 'join', name: 'Gamma', key: 'GAM', ownerId: 'boss', members: [{ userId: 'me', role: 'member' }] },
  { id: 'away', name: 'Epsilon', key: 'EPS', ownerId: 'boss', members: [] },
]

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Groceries',
    ownerId: 'me',
    privacy: 'PRIVATE',
    listMembers: [],
    ...overrides,
  } as unknown as TaskList
}

function renderSection(list: TaskList, onUpdate = vi.fn()) {
  render(<BoardViewSection list={list} currentUserId="me" canEditSettings onUpdate={onUpdate} />)
  return onUpdate
}

const optionValues = () =>
  Array.from((screen.getByRole('combobox') as HTMLSelectElement).options).map(option => option.value)

describe('list settings Project picker (AWTD-1703)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchProjects.mockResolvedValue(PROJECTS)
    apiCall.mockResolvedValue({ json: async () => ({}) })
  })

  it('offers None and exactly the projects the rule allows, never one the person only belongs to (AWTD-1703)', async () => {
    renderSection(makeList())
    await screen.findByRole('combobox')
    // Alpha (owner) and Beta (admin), by name; Gamma (member) and Epsilon (stranger) are left out.
    expect(optionValues()).toEqual(['', 'mine', 'run'])
  })

  it('moves the list with one PUT and reports the new project (AWTD-1703)', async () => {
    const onUpdate = renderSection(makeList())
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: 'run' } })

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(apiCall).toHaveBeenCalledWith('/api/v1/lists/list-1', {
      method: 'PUT',
      body: JSON.stringify({ projectId: 'run' }),
    })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'list-1', projectId: 'run' }))
  })

  it('removes the list from its project with projectId null (AWTD-1703)', async () => {
    const onUpdate = renderSection(makeList({ projectId: 'mine' }))
    const select = await screen.findByRole('combobox')
    expect(select).toHaveValue('mine')
    fireEvent.change(select, { target: { value: '' } })

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(apiCall).toHaveBeenCalledWith('/api/v1/lists/list-1', {
      method: 'PUT',
      body: JSON.stringify({ projectId: null }),
    })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }))
  })

  it('shows the server reason and does not move the list when the move is refused (AWTD-1703)', async () => {
    apiCall.mockRejectedValue(
      new ApiError('forbidden', 403, '/api/v1/lists/list-1', { error: 'Only a project owner or admin can move a list into it' }, null),
    )
    const onUpdate = renderSection(makeList())
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: 'mine' } })

    expect(await screen.findByText('Only a project owner or admin can move a list into it')).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(select).toHaveValue('')
  })

  it('is read-only and names the project when the list cannot leave it (AWTD-1703)', async () => {
    // A plain member of "join": the list is in it but they may not move it out.
    renderSection(makeList({ projectId: 'join' }))
    expect(await screen.findByText(/In Gamma\. Only a project owner or admin/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
