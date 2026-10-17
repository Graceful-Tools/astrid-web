/**
 * AWTD-1222: `backend`, `remote` and the whole of `supports` on a v1 list
 * (spec §11.2). The Apple apps switch their on-device Issues engine off on
 * `backend`, so two engines never edit one issue.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { listSupports } from '@/lib/backends/supports'
import { GITHUB_PROJECT_BACKEND } from '@/lib/backends/resolve'
import { listBackendFields, loadListBackendInfo, type ListBackendInfo } from '@/lib/backends/list-wire'

const CLASSIC = {
  multipleAssignees: false,
  repeatMode: 'roll_forward',
  privateTasks: true,
  membership: true,
  priority: true,
  dueDate: true,
  comments: true,
  fields: false,
  deleteTask: 'delete',
}

describe('listSupports — every key (AWTD-1222)', () => {
  it.each([{ backend: null }, {}, { backend: 'something_else' }])('a classic list (%o) is at its classic values', list => {
    expect(listSupports(list)).toEqual(CLASSIC)
  })

  // `fields` is true on a GitHub board since the fields API landed (AWTD-1208).
  // This branch predates it and expected false; main is the side that is right.
  it('a GitHub board with priority and due mapped', () => {
    expect(listSupports({ backend: GITHUB_PROJECT_BACKEND }, { priorityFieldId: 'F1', dueFieldId: 'F2' })).toEqual({
      multipleAssignees: true,
      repeatMode: 'spawn',
      privateTasks: false,
      membership: false,
      priority: true,
      dueDate: true,
      comments: true,
      fields: true,
      deleteTask: 'remove_from_list',
    })
  })

  it('an unmapped priority or due field is not supported, because the write would be refused', () => {
    const supports = listSupports({ backend: GITHUB_PROJECT_BACKEND }, { priorityFieldId: null, dueFieldId: null })
    expect(supports).toMatchObject({ priority: false, dueDate: false })
    expect(listSupports({ backend: GITHUB_PROJECT_BACKEND })).toMatchObject({ priority: false, dueDate: false })
  })

  it('a binding never changes a classic list', () => {
    expect(listSupports({ backend: null }, { priorityFieldId: null, dueFieldId: null })).toEqual(CLASSIC)
  })
})

describe('loadListBackendInfo (AWTD-1222)', () => {
  const board = { id: 'l1', backend: GITHUB_PROJECT_BACKEND, projectId: 'p1' }

  it('asks the database nothing when no list is GitHub-backed', async () => {
    const bindings = vi.fn()
    const info = await loadListBackendInfo([{ id: 'l0', backend: null, projectId: 'p0' }, { id: 'l9' }], { bindings })
    expect(info.size).toBe(0)
    expect(bindings).not.toHaveBeenCalled()
  })

  it('builds the project remote from the binding and its installation, in one read', async () => {
    const bindings = vi.fn().mockResolvedValue([
      { projectId: 'p1', number: 12, priorityFieldId: 'F1', dueFieldId: null, accountLogin: 'acme', accountType: 'Organization' },
    ])
    const info = await loadListBackendInfo([board, { id: 'l2', backend: null }], { bindings })
    expect(bindings).toHaveBeenCalledTimes(1)
    expect(bindings).toHaveBeenCalledWith(['p1'])
    expect(info.get('l1')).toEqual({
      remote: { url: 'https://github.com/orgs/acme/projects/12', owner: 'acme', number: 12 },
      binding: { priorityFieldId: 'F1', dueFieldId: null },
    })
    expect(info.has('l2')).toBe(false)
  })

  it("a user's project lives under /users", async () => {
    const bindings = vi.fn().mockResolvedValue([
      { projectId: 'p1', number: 3, priorityFieldId: null, dueFieldId: null, accountLogin: 'octocat', accountType: 'User' },
    ])
    const info = await loadListBackendInfo([board], { bindings })
    expect(info.get('l1')?.remote?.url).toBe('https://github.com/users/octocat/projects/3')
  })

  it('a binding whose installation row is gone has no remote, rather than a guessed link', async () => {
    const bindings = vi.fn().mockResolvedValue([
      { projectId: 'p1', number: 3, priorityFieldId: 'F1', dueFieldId: 'F2', accountLogin: null, accountType: null },
    ])
    const info = await loadListBackendInfo([board], { bindings })
    expect(info.get('l1')).toEqual({ remote: null, binding: { priorityFieldId: 'F1', dueFieldId: 'F2' } })
  })
})

describe('listBackendFields (AWTD-1222)', () => {
  it('a classic list: backend and remote are null, supports classic', () => {
    expect(listBackendFields({ id: 'l0', backend: null }, new Map())).toEqual({
      backend: null,
      remote: null,
      supports: CLASSIC,
    })
  })

  it('a GitHub board carries its backend, its remote and what it supports', () => {
    const remote = { url: 'https://github.com/orgs/acme/projects/12', owner: 'acme', number: 12 }
    const info = new Map<string, ListBackendInfo>([['l1', { remote, binding: { priorityFieldId: 'F1', dueFieldId: null } }]])
    const fields = listBackendFields({ id: 'l1', backend: GITHUB_PROJECT_BACKEND }, info)
    expect(fields.backend).toBe('github_project')
    expect(fields.remote).toEqual(remote)
    expect(fields.supports).toMatchObject({ priority: true, dueDate: false, deleteTask: 'remove_from_list' })
  })

  it('an unknown backend value never reaches the wire', () => {
    expect(listBackendFields({ id: 'l0', backend: 'something_else' }, new Map()).backend).toBeNull()
  })
})

describe('iteration lists on the wire (AWTD-1230)', () => {
  const sprintList = { id: 'l-it', backend: null, listType: 'iteration', remoteNodeId: 'PVTIF_sprint:it-41' }
  const field = { remoteId: 'PVTIF_sprint', iterations: [{ id: 'it-41', title: 'Sprint 41', startDate: '2026-10-05', duration: 14 }] }

  it('carries the window, hidden once the iteration has ended — decision (b)', async () => {
    const iterationFields = vi.fn(async () => [field])
    const running = await loadListBackendInfo([sprintList], { iterationFields, now: () => new Date('2026-10-17T12:00:00Z') })
    expect(iterationFields).toHaveBeenCalledWith(['PVTIF_sprint'])
    expect(listBackendFields(sprintList, running).iteration).toEqual({ startDate: '2026-10-05', endsOn: '2026-10-18', hidden: false })

    const ended = await loadListBackendInfo([sprintList], { iterationFields, now: () => new Date('2026-10-19T00:00:00Z') })
    expect(listBackendFields(sprintList, ended).iteration).toMatchObject({ hidden: true })
  })

  it('a list with no iteration flavor asks nothing and carries no window', async () => {
    const iterationFields = vi.fn(async () => [field])
    const info = await loadListBackendInfo([{ id: 'l0', backend: null, listType: 'milestone', remoteNodeId: 'MI_1' }], { iterationFields })
    expect(iterationFields).not.toHaveBeenCalled()
    expect(listBackendFields({ id: 'l0' }, info)).not.toHaveProperty('iteration')
  })

  it('an iteration GitHub no longer defines carries no window rather than a guessed one', async () => {
    const info = await loadListBackendInfo([sprintList], { iterationFields: async () => [{ ...field, iterations: [] }] })
    expect(listBackendFields(sprintList, info)).not.toHaveProperty('iteration')
  })
})
