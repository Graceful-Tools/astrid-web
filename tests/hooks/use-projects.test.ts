/**
 * @vitest-environment jsdom
 */

/**
 * Task ee3776e8 — project board #1: the projects picker data layer.
 * useProjects surfaces GET /api/projects; getProjectPrimaryListId resolves
 * which list to select when opening a project's board.
 */

import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjects, getProjectPrimaryListId, type ProjectSummary } from '@/hooks/use-projects'

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    name: 'My Project',
    color: '#3b82f6',
    ownerId: 'user-1',
    lists: [],
    ...overrides,
  }
}

describe('getProjectPrimaryListId (task ee3776e8)', () => {
  it('returns the first non-status domain list belonging to the project', () => {
    const p = project({
      lists: [
        { id: 'ready', listType: 'status', projectId: null } as never,
        { id: 'domain-a', listType: 'regular', projectId: 'proj-1' } as never,
        { id: 'domain-b', listType: 'regular', projectId: 'proj-1' } as never,
      ],
    })
    expect(getProjectPrimaryListId(p)).toBe('domain-a')
  })

  it('returns null when the project only has shared status columns', () => {
    const p = project({
      lists: [{ id: 'ready', listType: 'status', projectId: null } as never],
    })
    expect(getProjectPrimaryListId(p)).toBeNull()
  })

  it('ignores domain lists that belong to a different project', () => {
    const p = project({
      lists: [{ id: 'other', listType: 'regular', projectId: 'proj-2' } as never],
    })
    expect(getProjectPrimaryListId(p)).toBeNull()
  })
})

describe('useProjects (task ee3776e8)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches /api/projects and exposes the list', async () => {
    const projects = [project(), project({ id: 'proj-2', name: 'Second' })]
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ projects }) } as Response)
    ) as typeof fetch

    const { result } = renderHook(() => useProjects(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.projects).toHaveLength(2)
    expect(result.current.projects[1].name).toBe('Second')
    expect(global.fetch).toHaveBeenCalledWith('/api/projects')
  })

  it('does not fetch when disabled', () => {
    global.fetch = vi.fn() as typeof fetch
    renderHook(() => useProjects(false))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('surfaces an error on a failed response', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)) as typeof fetch
    const { result } = renderHook(() => useProjects(true))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.projects).toEqual([])
  })
})
