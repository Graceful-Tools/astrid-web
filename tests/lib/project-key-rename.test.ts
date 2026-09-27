/**
 * AWTD-1024 — renaming a project key after tasks exist (spec W4,
 * docs/specs/TASK_IDENTIFIERS.md).
 *
 * The contract is GitHub's renamed-repo redirect: the tasks take the new key,
 * and everything that already says the old one — a branch name, a commit
 * message, a link pasted in chat — keeps resolving. A key a rename frees stays
 * reserved, so `OLD-12` can never come to name a different task.
 */

import { describe, it, expect } from 'vitest'
import {
  renameProjectKey,
  resolveTaskIdOrIdentifier,
  canonicalizeIdentifier,
  checkRequestedProjectKey,
  ensureProjectKey,
  allocateTaskIdentifier,
} from '@/lib/task-identifier'

type FakeProject = { id: string; name: string; key: string | null; nextSequence: number }
type FakeAlias = { key: string; projectId: string }
type FakeTask = { id: string; identifier: string | null; sequence: number | null }

function fakeClient(state: {
  projects: FakeProject[]
  aliases?: FakeAlias[]
  tasks?: FakeTask[]
  lists?: Array<{ id: string; projectId: string }>
}) {
  const projects = state.projects
  const aliases = state.aliases ?? []
  const tasks = state.tasks ?? []
  const lists = state.lists ?? []

  const client = {
    project: {
      // A copy, as Prisma returns: the caller's read must not change under it.
      findUnique: async ({ where }: { where: { id?: string; key?: string } }) => {
        const found = projects.find(project =>
          where.id !== undefined ? project.id === where.id : project.key === where.key
        )
        return found ? { ...found } : null
      },
      findMany: async () => projects.filter(project => project.key !== null),
      update: async ({ where, data }: { where: { id: string }; data: { key: string } }) => {
        if (projects.some(project => project.key === data.key && project.id !== where.id)) {
          throw Object.assign(new Error('Unique constraint failed on key'), { code: 'P2002' })
        }
        const project = projects.find(candidate => candidate.id === where.id)!
        project.key = data.key
        return project
      },
    },
    projectKeyAlias: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const alias = aliases.find(candidate => candidate.key === where.key)
        if (!alias) return null
        return { ...alias, project: projects.find(project => project.id === alias.projectId) ?? null }
      },
      findMany: async () => aliases.slice(),
      create: async ({ data }: { data: FakeAlias }) => {
        if (aliases.some(alias => alias.key === data.key)) {
          throw Object.assign(new Error('Unique constraint failed on key'), { code: 'P2002' })
        }
        aliases.push({ ...data })
        return data
      },
      deleteMany: async ({ where }: { where: FakeAlias }) => {
        const before = aliases.length
        for (let i = aliases.length - 1; i >= 0; i--) {
          if (aliases[i].key === where.key && aliases[i].projectId === where.projectId) aliases.splice(i, 1)
        }
        return { count: before - aliases.length }
      },
    },
    task: {
      findUnique: async ({ where }: { where: { identifier: string } }) =>
        tasks.find(task => task.identifier === where.identifier) ?? null,
      findFirst: async ({ where }: { where: { identifier: { startsWith: string } } }) =>
        tasks.find(task => task.identifier?.startsWith(where.identifier.startsWith)) ?? null,
    },
    taskList: {
      findFirst: async ({ where }: { where: { id: { in: string[] } } }) =>
        lists.find(list => where.id.in.includes(list.id)) ?? null,
    },
    // renameProjectKey's re-identify: values are [newKey, oldKey].
    $executeRaw: async (query: { values: unknown[] }) => {
      const [newKey, oldKey] = query.values as [string, string]
      let count = 0
      for (const task of tasks) {
        if (task.sequence !== null && task.identifier === `${oldKey}-${task.sequence}`) {
          task.identifier = `${newKey}-${task.sequence}`
          count++
        }
      }
      return count
    },
    // allocateSequence's UPDATE ... RETURNING.
    $queryRaw: async (query: { values: unknown[] }) => {
      const project = projects.find(candidate => candidate.id === query.values[0])!
      project.nextSequence += 1
      return [{ nextSequence: project.nextSequence - 1, key: project.key }]
    },
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(client),
  }
  return client
}

function astridWeb() {
  const state = {
    projects: [
      { id: 'p-web', name: 'Astrid Web To-do', key: 'AWTD', nextSequence: 13 },
      { id: 'p-ios', name: 'Astrid iOS To-do', key: 'AITD', nextSequence: 5 },
    ] as FakeProject[],
    aliases: [] as FakeAlias[],
    tasks: [
      { id: 't-1', identifier: 'AWTD-1', sequence: 1 },
      { id: 't-12', identifier: 'AWTD-12', sequence: 12 },
      { id: 't-ios', identifier: 'AITD-4', sequence: 4 },
      { id: 't-solo', identifier: null, sequence: null },
    ] as FakeTask[],
    lists: [{ id: 'l-web', projectId: 'p-web' }],
  }
  return { state, client: fakeClient(state) }
}

describe('renameProjectKey (AWTD-1024)', () => {
  it('re-identifies the project\'s tasks as NEW-N, keeping each sequence number', async () => {
    const { state, client } = astridWeb()

    const result = await renameProjectKey('p-web', 'web', client as never)

    expect(result).toEqual({ key: 'WEB', previousKey: 'AWTD' })
    expect(state.projects[0].key).toBe('WEB')
    expect(state.tasks.map(task => task.identifier)).toEqual(['WEB-1', 'WEB-12', 'AITD-4', null])
  })

  it('keeps the old key as an alias, so AWTD-12 still resolves to the same task', async () => {
    const { client } = astridWeb()
    await renameProjectKey('p-web', 'WEB', client as never)

    expect(await resolveTaskIdOrIdentifier('AWTD-12', client as never)).toBe('t-12')
    expect(await resolveTaskIdOrIdentifier('awtd-12', client as never)).toBe('t-12')
    expect(await resolveTaskIdOrIdentifier('WEB-12', client as never)).toBe('t-12')
    expect(await canonicalizeIdentifier('AWTD-12', client as never)).toBe('WEB-12')
  })

  it('follows a chain of renames: the first key still reaches the task', async () => {
    const { client } = astridWeb()
    await renameProjectKey('p-web', 'WEB', client as never)
    await renameProjectKey('p-web', 'AW', client as never)

    expect(await resolveTaskIdOrIdentifier('AWTD-1', client as never)).toBe('t-1')
    expect(await resolveTaskIdOrIdentifier('WEB-1', client as never)).toBe('t-1')
    expect(await resolveTaskIdOrIdentifier('AW-1', client as never)).toBe('t-1')
  })

  it('reserves the freed key: nobody else may take it, requested or derived', async () => {
    const { state, client } = astridWeb()
    await renameProjectKey('p-web', 'WEB', client as never)

    expect(await renameProjectKey('p-ios', 'AWTD', client as never)).toMatchObject({ status: 409 })
    expect(await checkRequestedProjectKey('AWTD', client as never)).toMatchObject({ status: 409 })

    // A new "Astrid Web To-do" would derive AWTD — it must not get it.
    state.projects.push({ id: 'p-new', name: 'Astrid Web To-do', key: null, nextSequence: 1 })
    const derived = await ensureProjectKey('p-new', client as never)
    expect(derived).not.toBe('AWTD')
    expect(derived).not.toBe('WEB')
  })

  it('lets the project take its own old key back, and the alias goes with it', async () => {
    const { state, client } = astridWeb()
    await renameProjectKey('p-web', 'WEB', client as never)

    const back = await renameProjectKey('p-web', 'AWTD', client as never)

    expect(back).toEqual({ key: 'AWTD', previousKey: 'WEB' })
    expect(state.tasks[1].identifier).toBe('AWTD-12')
    expect(state.aliases).toEqual([{ key: 'WEB', projectId: 'p-web' }])
    expect(await resolveTaskIdOrIdentifier('WEB-12', client as never)).toBe('t-12')
  })

  it('refuses a key another project holds', async () => {
    const { state, client } = astridWeb()
    expect(await renameProjectKey('p-web', 'AITD', client as never)).toMatchObject({ status: 409 })
    expect(state.projects[0].key).toBe('AWTD')
  })

  it('refuses a key that already prefixes minted ids, e.g. from a deleted project', async () => {
    const { state, client } = astridWeb()
    state.tasks.push({ id: 't-orphan', identifier: 'OLD-3', sequence: 3 })
    expect(await renameProjectKey('p-web', 'OLD', client as never)).toMatchObject({ status: 409 })
  })

  it('rejects a malformed key and an unknown project', async () => {
    const { client } = astridWeb()
    expect(await renameProjectKey('p-web', '1AB', client as never)).toMatchObject({ status: 400 })
    expect(await renameProjectKey('p-web', 'TOOLONG', client as never)).toMatchObject({ status: 400 })
    expect(await renameProjectKey('p-missing', 'NEW', client as never)).toMatchObject({ status: 404 })
  })

  it('is a no-op when the key is unchanged', async () => {
    const { state, client } = astridWeb()
    expect(await renameProjectKey('p-web', 'awtd', client as never)).toEqual({ key: 'AWTD', previousKey: 'AWTD' })
    expect(state.aliases).toEqual([])
  })

  it('mints the next task under the new key', async () => {
    const { client } = astridWeb()
    await renameProjectKey('p-web', 'WEB', client as never)

    expect(await allocateTaskIdentifier(['l-web'], client as never)).toEqual({ identifier: 'WEB-13', sequence: 13 })
  })
})

describe('resolveTaskIdOrIdentifier without a rename (AWTD-1024)', () => {
  it('still answers null for an identifier nobody holds, alias or not', async () => {
    const { client } = astridWeb()
    expect(await resolveTaskIdOrIdentifier('NOPE-1', client as never)).toBeNull()
    expect(await canonicalizeIdentifier('NOPE-1', client as never)).toBe('NOPE-1')
  })
})
