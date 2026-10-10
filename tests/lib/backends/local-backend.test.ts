/**
 * Spec §5.2 step 8 — the TaskBackend seam ships with one implementation, and
 * it must change nothing: Astrid's own tasks are written exactly as before.
 */

import { describe, it, expect, vi } from 'vitest'
import { localTaskBackend } from '@/lib/backends/local'
import { taskBackendFor } from '@/lib/backends/resolve'
import { githubProjectTaskBackend, GITHUB_PROJECT_READ_ONLY } from '@/lib/backends/github-project'

describe('localTaskBackend', () => {
  it('accepts a create unchanged', async () => {
    const data = { title: 'T', completed: false }
    await expect(localTaskBackend.createTask({ actorId: 'u' }, data)).resolves.toEqual({ ok: true, value: data })
  })

  it('accepts an update unchanged', async () => {
    const data = { completed: true, completedAt: new Date(0) }
    await expect(localTaskBackend.updateTask({ actorId: 'u' }, 't', data)).resolves.toEqual({ ok: true, value: data })
  })

  it('accepts a delete', async () => {
    await expect(localTaskBackend.deleteTask({ actorId: 'u' }, 't')).resolves.toEqual({ ok: true, value: undefined })
  })
})

describe('taskBackendFor (AWTD-1151)', () => {
  it('is local, with no query, while the deployment has no GitHub Projects (Astrid)', async () => {
    const countBound = vi.fn(async () => 1)
    expect((await taskBackendFor(['list-1'], { githubProjects: false, countBound })).kind).toBe('local')
    expect(countBound).not.toHaveBeenCalled()
  })

  it('is local for a task on no list, with no query', async () => {
    const countBound = vi.fn(async () => 1)
    expect((await taskBackendFor([], { githubProjects: true, countBound })).kind).toBe('local')
    expect(countBound).not.toHaveBeenCalled()
  })

  it('is local when none of the lists is bound to GitHub', async () => {
    expect((await taskBackendFor(['a', 'b'], { githubProjects: true, countBound: async () => 0 })).kind).toBe('local')
  })

  it('is github_project when ANY list is bound (§5.3), and asks once for all of them', async () => {
    const countBound = vi.fn(async () => 1)
    expect((await taskBackendFor(['personal', 'gh'], { githubProjects: true, countBound })).kind).toBe('github_project')
    expect(countBound).toHaveBeenCalledWith(['personal', 'gh'])
  })
})

describe('githubProjectTaskBackend — read-only in P4 (AWTD-1151)', () => {
  it.each(['createTask', 'updateTask', 'deleteTask'] as const)('accepts %s that came FROM GitHub (AWTD-1153)', async method => {
    const ctx = { actorId: 'u', origin: 'remote' as const }
    const call =
      method === 'createTask'
        ? githubProjectTaskBackend.createTask(ctx, { title: 'x' })
        : method === 'updateTask'
          ? githubProjectTaskBackend.updateTask(ctx, 't', { title: 'x' })
          : githubProjectTaskBackend.deleteTask(ctx, 't')
    await expect(call).resolves.toMatchObject({ ok: true })
  })

  it.each(['createTask', 'updateTask', 'deleteTask'] as const)('refuses %s with a typed 403', async method => {
    const call =
      method === 'createTask'
        ? githubProjectTaskBackend.createTask({ actorId: 'u' }, { title: 'x' })
        : method === 'updateTask'
          ? githubProjectTaskBackend.updateTask({ actorId: 'u' }, 't', { title: 'x' })
          : githubProjectTaskBackend.deleteTask({ actorId: 'u' }, 't')
    await expect(call).resolves.toEqual({ ok: false, status: 403, error: GITHUB_PROJECT_READ_ONLY })
  })
})
