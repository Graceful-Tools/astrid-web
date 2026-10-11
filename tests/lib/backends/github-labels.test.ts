/**
 * AWTD-1188 (P6c-2): a GitHub label is GitHub's to change in this slice.
 *
 * Labels arrive from GitHub as membership in label-flavor lists. Writing a
 * label change THROUGH to GitHub is not built yet, so adding or removing one
 * from Astrid is refused with a named 400 — never accepted and then undone by
 * the next hydration.
 *
 * Pinned:
 *   - joining or leaving a GitHub label list is `github_label_read_only`,
 *     on create and on update, whichever backend owns the task;
 *   - a write that keeps the labels as they are passes, and so does every
 *     write that does not touch lists — without a query;
 *   - GitHub's own news (origin 'remote') passes;
 *   - a label the task already carries is not being ADDED, so it needs no
 *     add-permission on the label list.
 */

import { describe, it, expect, vi } from 'vitest'
import { localTaskBackend } from '@/lib/backends/local'
import { taskBackendFor } from '@/lib/backends/resolve'
import {
  GITHUB_LABEL_READ_ONLY,
  changesGithubLabels,
  isHeldGithubLabel,
  withGithubLabelGuard,
} from '@/lib/backends/github-labels'

const ids = (...list: string[]) => list.map(id => ({ id }))
const held = { id: 'label-bug', held: true }
const other = { id: 'label-docs', held: false }

describe('changesGithubLabels (AWTD-1188)', () => {
  it('a set that drops a held label, or brings a new one, changes labels', () => {
    expect(changesGithubLabels({ set: ids('board') }, [held])).toBe(true)
    expect(changesGithubLabels({ set: ids('board', 'label-bug', 'label-docs') }, [held, other])).toBe(true)
  })

  it('a set that keeps the labels as they are does not', () => {
    expect(changesGithubLabels({ set: ids('board', 'personal', 'label-bug') }, [held])).toBe(false)
  })

  it('connect and disconnect are judged the same way', () => {
    expect(changesGithubLabels({ connect: ids('label-docs') }, [other])).toBe(true)
    expect(changesGithubLabels({ disconnect: ids('label-bug') }, [held])).toBe(true)
    expect(changesGithubLabels({ connect: ids('label-bug'), disconnect: ids('status-doing') }, [held])).toBe(false)
  })

  it('no list write, or no GitHub label in sight, changes nothing', () => {
    expect(changesGithubLabels(undefined, [held])).toBe(false)
    expect(changesGithubLabels({ set: ids('personal') }, [])).toBe(false)
  })
})

describe('withGithubLabelGuard (AWTD-1188)', () => {
  const refused = { ok: false, status: 400, error: GITHUB_LABEL_READ_ONLY }

  it('refuses an update that removes a GitHub label, and asks the backend nothing', async () => {
    const inner = { ...localTaskBackend, updateTask: vi.fn(localTaskBackend.updateTask) }
    const loadLabels = vi.fn(async () => [held])
    const guarded = withGithubLabelGuard(inner, loadLabels)

    await expect(guarded.updateTask({ actorId: 'u' }, 't1', { lists: { set: ids('board') } })).resolves.toEqual(refused)
    expect(loadLabels).toHaveBeenCalledWith('t1', ['board'])
    expect(inner.updateTask).not.toHaveBeenCalled()
  })

  it('refuses a create that puts a new task in a GitHub label list', async () => {
    const guarded = withGithubLabelGuard(localTaskBackend, async () => [other])
    await expect(guarded.createTask({ actorId: 'u' }, { title: 'x', lists: { connect: ids('board', 'label-docs') } })).resolves.toEqual(refused)
  })

  it('passes a write that leaves the labels alone, and one that touches no list without a query', async () => {
    const loadLabels = vi.fn(async () => [held])
    const guarded = withGithubLabelGuard(localTaskBackend, loadLabels)

    const move = { lists: { set: ids('other-board', 'label-bug') } }
    await expect(guarded.updateTask({ actorId: 'u' }, 't1', move)).resolves.toEqual({ ok: true, value: move })

    loadLabels.mockClear()
    await expect(guarded.updateTask({ actorId: 'u' }, 't1', { title: 'renamed' })).resolves.toMatchObject({ ok: true })
    expect(loadLabels).not.toHaveBeenCalled()
  })

  it('passes GitHub’s own news', async () => {
    const loadLabels = vi.fn(async () => [held])
    const guarded = withGithubLabelGuard(localTaskBackend, loadLabels)
    await expect(guarded.updateTask({ actorId: 'u', origin: 'remote' }, 't1', { lists: { set: [] } })).resolves.toMatchObject({ ok: true })
    expect(loadLabels).not.toHaveBeenCalled()
  })

  it('keeps the backend’s kind and its delete', async () => {
    const guarded = withGithubLabelGuard(localTaskBackend, async () => [])
    expect(guarded.kind).toBe('local')
    await expect(guarded.deleteTask({ actorId: 'u' }, 't1')).resolves.toEqual({ ok: true, value: undefined })
  })
})

describe('taskBackendFor guards labels only where GitHub Projects exist (AWTD-1188)', () => {
  it('Astrid gets the bare local backend: no guard, no query', async () => {
    expect(await taskBackendFor(['list-1'], { githubProjects: false, countBound: async () => 0 })).toBe(localTaskBackend)
  })

  it('a GitHub brand’s LOCAL task is guarded too — a label list is not a bound board', async () => {
    const backend = await taskBackendFor(['personal'], { githubProjects: true, countBound: async () => 0 })
    expect(backend.kind).toBe('local')
    expect(backend).not.toBe(localTaskBackend)
  })
})

describe('isHeldGithubLabel (AWTD-1188)', () => {
  const label = { id: 'label-bug', listType: 'label', remoteNodeId: 'LA_bug' }

  it('a GitHub label the task already carries is not being added', () => {
    expect(isHeldGithubLabel(label, [{ id: 'board' }, { id: 'label-bug' }])).toBe(true)
  })

  it('one it does not carry is, and so is any Astrid list', () => {
    expect(isHeldGithubLabel(label, [{ id: 'board' }])).toBe(false)
    expect(isHeldGithubLabel({ id: 'mine', listType: 'label', remoteNodeId: null }, [{ id: 'mine' }])).toBe(false)
    expect(isHeldGithubLabel({ id: 'board', listType: 'regular', remoteNodeId: null }, [{ id: 'board' }])).toBe(false)
  })
})
