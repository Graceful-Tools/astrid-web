/**
 * AWTD-1342: lib/offline-db/database.ts had no test. Runs against the real
 * Dexie over fake-indexeddb (loaded globally by tests/setup.ts).
 *
 * Pinned:
 *   - a browser still holding the v1 database upgrades to v3 in place: v1 rows
 *     survive, the v2/v3 tables appear, and the new mutations.parentId index works;
 *   - a v2 database upgrades the same way;
 *   - clearAll empties all ten tables and leaves the database usable;
 *   - clearAll after the database was marked unavailable is a no-op;
 *   - a corruption-class failure during clearAll disables IndexedDB for the
 *     session and deletes the database so the next load recreates it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'

const DB_NAME = 'AstridOfflineDB'

const V1 = {
  tasks: 'id, listId, assignedToId, dueDate, completed, updatedAt',
  lists: 'id, ownerId, privacy, updatedAt, isFavorite',
  users: 'id, email',
  publicTasks: 'id, listId, updatedAt',
  mutations: 'id, type, entity, entityId, timestamp, status',
}
const V2 = {
  ...V1,
  comments: 'id, taskId, authorId, createdAt',
  mutations: 'id, type, entity, entityId, timestamp, status, parentId',
  idMappings: 'tempId, realId, entity, timestamp',
}

const ALL_TABLES = [
  'tasks', 'lists', 'users', 'publicTasks', 'comments',
  'mutations', 'idMappings', 'listMembers', 'attachments', 'syncCursors',
]

async function loadOfflineDB() {
  vi.resetModules() // fresh singleton and a fresh "IndexedDB available" flag
  return (await import('@/lib/offline-db/database')).offlineDB
}

let opened: Dexie | null = null

beforeEach(async () => {
  await Dexie.delete(DB_NAME)
})

afterEach(async () => {
  opened?.close()
  opened = null
  vi.restoreAllMocks()
  await Dexie.delete(DB_NAME)
})

describe('offline DB schema upgrades (AWTD-1342)', () => {
  it('upgrades a v1 database to v3 without losing its rows', async () => {
    const legacy = new Dexie(DB_NAME)
    legacy.version(1).stores(V1)
    await legacy.open()
    await legacy.table('tasks').put({ id: 't1', title: 'Old task', listId: 'l1', completed: false })
    await legacy.table('lists').put({ id: 'l1', name: 'Inbox', ownerId: 'u1' })
    await legacy.table('mutations').put({ id: 'm1', type: 'update', entity: 'task', entityId: 't1', timestamp: 1, status: 'pending' })
    legacy.close()

    const db = await loadOfflineDB()
    opened = db
    await db.open()

    expect(db.verno).toBe(3)
    expect(db.tables.map(t => t.name).sort()).toEqual([...ALL_TABLES].sort())
    expect(await db.tasks.get('t1')).toMatchObject({ title: 'Old task' })
    expect(await db.lists.get('l1')).toMatchObject({ name: 'Inbox' })

    // v2 added a parentId index to mutations; v1 rows are queryable alongside new ones.
    await db.mutations.put({ id: 'm2', type: 'create', entity: 'comment', entityId: 'c1', timestamp: 2, status: 'pending', parentId: 'm1' } as never)
    expect((await db.mutations.where('parentId').equals('m1').toArray()).map(m => m.id)).toEqual(['m2'])
    expect(await db.mutations.count()).toBe(2)

    // v3 tables are writable.
    await db.syncCursors.put({ entity: 'tasks', lastSync: 5 } as never)
    expect(await db.syncCursors.get('tasks')).toMatchObject({ lastSync: 5 })
  })

  it('upgrades a v2 database to v3, keeping comments and id mappings', async () => {
    const legacy = new Dexie(DB_NAME)
    legacy.version(1).stores(V1)
    legacy.version(2).stores(V2)
    await legacy.open()
    await legacy.table('comments').put({ id: 'c1', taskId: 't1', authorId: 'u1', createdAt: 1 })
    await legacy.table('idMappings').put({ tempId: 'temp-1', realId: 'real-1', entity: 'task', timestamp: 1 })
    legacy.close()

    const db = await loadOfflineDB()
    opened = db
    await db.open()

    expect(db.verno).toBe(3)
    expect(await db.comments.get('c1')).toMatchObject({ taskId: 't1' })
    expect(await db.idMappings.get('temp-1')).toMatchObject({ realId: 'real-1' })
    expect(await db.listMembers.count()).toBe(0)
  })
})

describe('offline DB task index (AWTD-1342)', () => {
  /**
   * REAL BUG, latent (AWTD-1342): lib/offline-db/database.ts:40 indexes tasks on
   * `listId`, but a Task (types/task.ts) carries `lists: TaskList[]` — there is
   * no `listId` field. So OfflineTaskOperations.getTasksByList
   * (lib/offline-db/tasks.ts:34) always returns [] for a real task. Unreachable
   * today: its only route in is useCachedTasks({ listId }), which nothing calls.
   * A fix needs a v4 schema with a multi-entry index (e.g. `*listIds`) and
   * writers that populate it.
   */
  it.fails('a saved task can be found by a list it is on', async () => {
    const db = await loadOfflineDB()
    opened = db
    await db.tasks.put({ id: 't1', title: 'On a list', lists: [{ id: 'l1' }] } as never)
    expect((await db.tasks.where('listId').equals('l1').toArray()).map(t => t.id)).toEqual(['t1'])
  })
})

describe('offlineDB.clearAll (AWTD-1342)', () => {
  async function seeded() {
    const db = await loadOfflineDB()
    opened = db
    await db.tasks.put({ id: 't1' } as never)
    await db.lists.put({ id: 'l1' } as never)
    await db.users.put({ id: 'u1' } as never)
    await db.publicTasks.put({ id: 'p1' } as never)
    await db.comments.put({ id: 'c1' } as never)
    await db.mutations.put({ id: 'm1' } as never)
    await db.idMappings.put({ tempId: 'x' } as never)
    await db.listMembers.put({ id: 'lm1' } as never)
    await db.attachments.put({ id: 'a1' } as never)
    await db.syncCursors.put({ entity: 'tasks' } as never)
    return db
  }

  it('empties every table and leaves the database usable', async () => {
    const db = await seeded()
    expect((await db.getStorageInfo()).total).toBe(10)

    await db.clearAll()

    const info = await db.getStorageInfo()
    expect(info.total).toBe(0)
    for (const name of ALL_TABLES) expect(info[name as keyof typeof info]).toBe(0)
    await db.tasks.put({ id: 't2' } as never)
    expect(await db.tasks.count()).toBe(1)
  })

  it('a corruption-class failure disables IndexedDB for the session and deletes the database', async () => {
    const db = await seeded()
    // The class is not exported; its static availability flag is read off the instance.
    const OfflineDatabaseClass = db.constructor as unknown as { isAvailable(): boolean; getError(): Error | null }
    const closed = Object.assign(new Error('Database has been closed'), { name: 'DatabaseClosedError' })
    vi.spyOn(db.tasks, 'clear').mockRejectedValueOnce(closed)

    await db.clearAll()

    expect(OfflineDatabaseClass.isAvailable()).toBe(false)
    expect(OfflineDatabaseClass.getError()).toBe(closed)
    expect(await Dexie.exists(DB_NAME)).toBe(false)
  })

  it('is a no-op once IndexedDB has been marked unavailable', async () => {
    const db = await seeded()
    await db.safeOperation(async () => {
      throw Object.assign(new Error('backing store failed'), { name: 'UnknownError' })
    }, null)
    const clear = vi.spyOn(db.tasks, 'clear')

    await db.clearAll()

    expect(clear).not.toHaveBeenCalled()
  })
})
