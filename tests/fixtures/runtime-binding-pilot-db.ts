/**
 * An in-memory database for the runtime-binding pilot tests (AWTD-1669).
 *
 * Just enough of Prisma's filter language to run the REAL where clauses the
 * queue and both claim services build — equality, in/notIn/not/lte/gt, AND/OR/
 * NOT, and the `some`/`none` relation filters over boards, comments and the
 * assignee — so a test proves what a query would return, not what a mock was
 * told to return.
 *
 * Transactions are modelled the way the fence relies on Postgres:
 *  - `$queryRaw\`... FOR UPDATE\`` takes an exclusive per-row lock held until the
 *    transaction ends; a second transaction asking for the same row waits;
 *  - every operation yields to the event loop first, so two concurrent claims
 *    genuinely interleave (and, without the lock, genuinely race);
 *  - a transaction that throws restores the rows as they were (rollback).
 * `locking = false` turns the lock into a no-op: the negative control that
 * shows the fence, not luck, is what prevents a double claim.
 */

type Row = Record<string, any>

export interface PilotDb {
  lists: Row[]
  tasks: Row[]
  bindings: Row[]
  audits: Row[]
  users: Row[]
  comments: Row[]
  locking: boolean
  failAuditCreate: boolean
  failBindingLookup: boolean
  calls: string[]
  client: any
  reset(): void
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function isPlainObject(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

function cmp(a: unknown): number | string | null {
  if (a instanceof Date) return a.getTime()
  return a as number | string | null
}

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond === null) return actual === null || actual === undefined
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime()
  if (isPlainObject(cond)) {
    for (const [op, v] of Object.entries(cond)) {
      if (op === 'in' && !(v as unknown[]).includes(actual)) return false
      if (op === 'notIn' && (v as unknown[]).includes(actual)) return false
      if (op === 'not' && matchValue(actual, v)) return false
      if (op === 'equals' && JSON.stringify(actual) !== JSON.stringify(v)) return false
      if (op === 'lte' && !(actual != null && (cmp(actual) as number) <= (cmp(v) as number))) return false
      if (op === 'lt' && !(actual != null && (cmp(actual) as number) < (cmp(v) as number))) return false
      if (op === 'gt' && !(actual != null && (cmp(actual) as number) > (cmp(v) as number))) return false
      if (op === 'contains' && !(typeof actual === 'string' && actual.includes(v as string))) return false
    }
    return true
  }
  return actual === cond
}

export function createPilotDb(): PilotDb {
  const db = {
    lists: [] as Row[],
    tasks: [] as Row[],
    bindings: [] as Row[],
    audits: [] as Row[],
    users: [] as Row[],
    comments: [] as Row[],
    locking: true,
    failAuditCreate: false,
    failBindingLookup: false,
    calls: [] as string[],
  } as PilotDb

  const listById = (id: string) => db.lists.find(l => l.id === id)
  const userById = (id: string | null) => (id ? db.users.find(u => u.id === id) : undefined)
  const commentsOf = (taskId: string) => db.comments.filter(c => c.taskId === taskId)

  function matchRow(row: Row, where: Row | undefined, related: (key: string, row: Row) => Row[] | Row | null | undefined): boolean {
    if (!where) return true
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'AND') {
        const all = Array.isArray(cond) ? cond : [cond]
        if (!all.every(w => matchRow(row, w, related))) return false
      } else if (key === 'OR') {
        if (!(cond as Row[]).some(w => matchRow(row, w, related))) return false
      } else if (key === 'NOT') {
        const all = Array.isArray(cond) ? cond : [cond]
        if (all.some(w => matchRow(row, w, related))) return false
      } else {
        const rel = related(key, row)
        if (rel !== undefined) {
          if (Array.isArray(rel)) {
            const c = cond as Row
            const sub = (r: Row, w: Row) => matchRow(r, w, relatedOf(key))
            if ('some' in c && !rel.some(r => sub(r, c.some))) return false
            if ('none' in c && rel.some(r => sub(r, c.none))) return false
            if ('every' in c && !rel.every(r => sub(r, c.every))) return false
          } else {
            const c = cond as Row
            const target = 'is' in c ? c.is : c
            if (!rel || !matchRow(rel, target, relatedOf(key))) return false
          }
        } else if (!matchValue(row[key], cond)) {
          return false
        }
      }
    }
    return true
  }

  function relatedOf(model: string) {
    return (key: string, row: Row): Row[] | Row | null | undefined => {
      if (model === 'task' || model === 'tasks') {
        if (key === 'lists') return (row.listIds as string[]).map(listById).filter(Boolean) as Row[]
        if (key === 'comments') return commentsOf(row.id)
        if (key === 'assignee') return userById(row.assigneeId) ?? null
      }
      if (model === 'lists' || model === 'list') {
        if (key === 'listMembers') return []
      }
      if (model === 'comments') {
        if (key === 'author') return userById(row.authorId) ?? null
      }
      return undefined
    }
  }

  const taskMatches = (t: Row, where: Row | undefined) => matchRow(t, where, relatedOf('task'))

  function shapeTask(t: Row): Row {
    return {
      ...t,
      lists: (t.listIds as string[]).map(id => ({ ...listById(id) })),
      comments: commentsOf(t.id),
      assignee: userById(t.assigneeId) ?? null,
    }
  }

  function pick(row: Row, select?: Row): Row {
    if (!select) return { ...row }
    const out: Row = {}
    for (const [key, v] of Object.entries(select)) {
      if (v === true) out[key] = row[key]
      else if (isPlainObject(v) && 'select' in v) {
        const inner = row[key]
        out[key] = Array.isArray(inner) ? inner.map(r => pick(r, v.select)) : inner ? pick(inner, v.select) : inner
      }
    }
    return out
  }

  const locks = new Map<string, Promise<void>>()

  function makeClient(txLocks?: Array<() => void>) {
    const log = (name: string) => db.calls.push(name)
    return {
      task: {
        findUnique: async ({ where, select }: Row) => {
          await tick(); log('task.findUnique')
          const t = db.tasks.find(x => x.id === where.id)
          return t ? pick(shapeTask(t), select) : null
        },
        findFirst: async ({ where, select }: Row) => {
          await tick(); log('task.findFirst')
          const t = db.tasks.find(x => taskMatches(x, where))
          return t ? pick(shapeTask(t), select) : null
        },
        findMany: async ({ where, select }: Row) => {
          await tick(); log('task.findMany')
          return db.tasks.filter(x => taskMatches(x, where)).map(t => pick(shapeTask(t), select))
        },
        count: async ({ where }: Row) => {
          await tick(); log('task.count')
          return db.tasks.filter(x => taskMatches(x, where)).length
        },
        updateMany: async ({ where, data }: Row) => {
          await tick(); log('task.updateMany')
          const hits = db.tasks.filter(x => taskMatches(x, where))
          for (const t of hits) Object.assign(t, data, { updatedAt: new Date(t.updatedAt.getTime() + 1) })
          return { count: hits.length }
        },
        updateManyAndReturn: async ({ where, data, select }: Row) => {
          await tick(); log('task.updateManyAndReturn')
          const hits = db.tasks.filter(x => taskMatches(x, where))
          for (const t of hits) Object.assign(t, data, { updatedAt: new Date(t.updatedAt.getTime() + 1) })
          return hits.map(t => pick(shapeTask(t), select))
        },
      },
      taskList: {
        // ADEV-36: the orchestration policy read. These boards store none, so the default applies.
        findUnique: async () => null,
        findFirst: async ({ where, select }: Row) => {
          await tick(); log('taskList.findFirst')
          const l = db.lists.find(x => matchRow(x, where, relatedOf('list')))
          return l ? pick(l, select) : null
        },
      },
      runtimeBinding: {
        findUnique: async ({ where, select }: Row) => {
          await tick(); log('runtimeBinding.findUnique')
          if (db.failBindingLookup) throw new Error('database unavailable')
          const b = db.bindings.find(x => x.id === where.id)
          return b ? pick(b, select) : null
        },
        findMany: async ({ where, select }: Row) => {
          await tick(); log('runtimeBinding.findMany')
          if (db.failBindingLookup) throw new Error('database unavailable')
          return db.bindings.filter(x => matchRow(x, where, () => undefined)).map(b => pick(b, select))
        },
      },
      runtimeBindingAuditEvent: {
        create: async ({ data }: Row) => {
          await tick(); log('runtimeBindingAuditEvent.create')
          if (db.failAuditCreate) throw new Error('audit store unavailable')
          const row = { id: `audit-${db.audits.length + 1}`, createdAt: new Date(), ...data }
          db.audits.push(row)
          return row
        },
      },
      user: {
        findUnique: async ({ where, select }: Row) => {
          await tick(); log('user.findUnique')
          const u = db.users.find(x => (where.id ? x.id === where.id : x.email === where.email))
          return u ? pick(u, select) : null
        },
      },
      comment: {
        create: async ({ data }: Row) => {
          await tick(); log('comment.create')
          const row = { id: `comment-${db.comments.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }
          db.comments.push(row)
          return row
        },
      },
      chatChannel: { findUnique: async () => null },
      $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        log('$queryRaw')
        if (!txLocks) throw new Error('FOR UPDATE outside a transaction')
        if (!db.locking) { await tick(); return [] }
        const key = String(values[0])
        while (locks.has(key)) await locks.get(key)
        let release!: () => void
        locks.set(key, new Promise<void>(resolve => { release = () => { locks.delete(key); resolve() } }))
        txLocks.push(release)
        await tick()
        return db.bindings.some(b => b.id === key) ? [{ id: key }] : []
      },
    }
  }

  const client: any = makeClient()
  client.$transaction = async (fn: (tx: any) => Promise<unknown>) => {
    db.calls.push('$transaction')
    const held: Array<() => void> = []
    const tx = makeClient(held)
    const snapshot = { tasks: structuredClone(db.tasks), audits: structuredClone(db.audits), comments: structuredClone(db.comments) }
    try {
      return await fn(tx)
    } catch (err) {
      db.tasks.splice(0, db.tasks.length, ...snapshot.tasks)
      db.audits.splice(0, db.audits.length, ...snapshot.audits)
      db.comments.splice(0, db.comments.length, ...snapshot.comments)
      throw err
    } finally {
      held.forEach(release => release())
    }
  }
  db.client = client

  db.reset = () => {
    for (const key of ['lists', 'tasks', 'bindings', 'audits', 'users', 'comments', 'calls'] as const) {
      ;(db[key] as unknown[]).length = 0
    }
    db.locking = true
    db.failAuditCreate = false
    db.failBindingLookup = false
    locks.clear()
  }
  return db
}
export const pilotDb = createPilotDb()
