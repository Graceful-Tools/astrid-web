/**
 * AWTD-1668 — admin enrollment of business runtime bindings, against an
 * in-memory database so the whole lifecycle and its audit trail are visible.
 *
 * Jon's decisions (2026-11-14): board-level opt-in on a DEDICATED
 * SINGLE-BUSINESS deployment only (astrid.cc refuses by default), and ONE
 * trusted execution board with agreement among all bound boards — conflicts are
 * HELD, never resolved by picking the first list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Row { [key: string]: unknown }

const db = vi.hoisted(() => {
  const state = {
    bindings: [] as Row[],
    revisions: [] as Row[],
    audits: [] as Row[],
    lists: [] as Row[],
    /** taskId → list ids */
    taskLists: new Map<string, string[]>(),
    seq: 0,
  }
  const pickBy = (row: Row, select?: Record<string, unknown>) => {
    if (!select) return { ...row }
    const out: Row = {}
    for (const key of Object.keys(select)) out[key] = row[key]
    return out
  }
  const matchesValue = (actual: unknown, cond: unknown): boolean => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>
      if ('in' in c) return (c.in as unknown[]).includes(actual)
      if ('not' in c) return c.not === null ? actual !== null && actual !== undefined : actual !== c.not && actual !== null && actual !== undefined
    }
    return actual === cond
  }
  const listMatches = (list: Row, where: Record<string, unknown>): boolean => {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'AND') {
        if (!(cond as Record<string, unknown>[]).every(w => listMatches(list, w))) return false
      } else if (key === 'tasks') {
        const boardId = ((cond as any).some.lists.some.id) as string
        const shared = [...state.taskLists.values()].some(ids => ids.includes(boardId) && ids.includes(list.id as string))
        if (!shared) return false
      } else if (!matchesValue(list[key] ?? null, cond)) {
        return false
      }
    }
    return true
  }
  const client = {
    runtimeBinding: {
      findMany: async () => state.bindings.map(b => ({ ...b })),
      findUnique: async ({ where }: any) => {
        const b = state.bindings.find(x => x.id === where.id)
        return b ? { ...b } : null
      },
      create: async ({ data }: any) => {
        const row = {
          id: `binding-${++state.seq}`,
          revision: 1,
          state: 'pending',
          approvedBy: null,
          approvedRevision: null,
          verifiedAt: null,
          approvedAt: null,
          activatedAt: null,
          suspendedAt: null,
          revokedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }
        state.bindings.push(row)
        return { ...row }
      },
      updateMany: async ({ where, data }: any) => {
        const b = state.bindings.find(x => Object.entries(where).every(([k, v]) => x[k] === v))
        if (!b) return { count: 0 }
        Object.assign(b, data)
        return { count: 1 }
      },
    },
    runtimeBindingRevision: {
      create: async ({ data }: any) => {
        if (state.revisions.some(r => r.bindingId === data.bindingId && r.revision === data.revision)) {
          throw new Error('unique violation: revision snapshots are immutable')
        }
        const row = { id: `rev-${++state.seq}`, createdAt: new Date(), ...data }
        state.revisions.push(row)
        return row
      },
      findUnique: async ({ where }: any) => {
        const { bindingId, revision } = where.bindingId_revision
        return state.revisions.find(r => r.bindingId === bindingId && r.revision === revision) ?? null
      },
      findMany: async ({ where }: any) => state.revisions.filter(r => r.bindingId === where.bindingId),
    },
    runtimeBindingAuditEvent: {
      create: async ({ data }: any) => {
        const row = { id: `evt-${++state.seq}`, createdAt: new Date(), ...data }
        state.audits.push(row)
        return row
      },
    },
    taskList: {
      findUnique: async ({ where }: any) => {
        const l = state.lists.find(x => x.id === where.id)
        return l ? { ...l } : null
      },
      findMany: async ({ where, select, take }: any) =>
        state.lists.filter(l => listMatches(l, where)).slice(0, take ?? Infinity).map(l => pickBy(l, select)),
      updateMany: async ({ where, data }: any) => {
        const l = state.lists.find(x => x.id === where.id && (!('runtimeBindingId' in where) || (x.runtimeBindingId ?? null) === where.runtimeBindingId))
        if (!l) return { count: 0 }
        Object.assign(l, data)
        return { count: 1 }
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  }
  return { state, client }
})

vi.mock('@/lib/prisma', () => ({ prisma: db.client }))
vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth')
  const admins = new Set(['admin-1', 'admin-2'])
  return {
    ...actual,
    isAdmin: vi.fn(async (id: string) => admins.has(id)),
    requireAdmin: vi.fn(async (id: string) => {
      if (!admins.has(id)) throw new actual.AdminAuthError('Admin access required')
    }),
  }
})

import {
  RuntimeBindingEnrollmentError,
  attachBoardToRuntimeBinding,
  createRuntimeBinding,
  detachBoardFromRuntimeBinding,
  listRuntimeBindings,
  transitionRuntimeBinding,
  updateRuntimeBinding,
} from '@/lib/runtime-binding/enrollment'

const ADMIN = { userId: 'admin-1' }
const FLAG = 'ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS'

const INPUT = {
  managementScope: 'deployment-business',
  runtimeKind: 'business-machine',
  runtimeSubjectId: 'machine:build-01',
  allowedAgentIds: ['claude'],
  transport: 'polling',
  credentialRef: 'cred:build-01:gen1',
  allowedRepositoryRefs: ['github:acme/app'],
  allowedBoardIds: ['board-1', 'board-2'],
  maxConcurrentRuns: 1,
  billingSource: 'business-provided',
  billingAccountRef: 'payer:acme',
}

const list = (id: string, over: Row = {}) => ({
  id,
  name: `Board ${id}`,
  ownerId: 'admin-1',
  privacy: 'PRIVATE',
  runtimeBindingId: null,
  listMembers: [],
  project: null,
  ...over,
})

async function expectRefusal(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(RuntimeBindingEnrollmentError)
  await promise.catch((err: RuntimeBindingEnrollmentError) => expect(err.code).toBe(code))
}

async function activeBinding() {
  const b = await createRuntimeBinding(ADMIN, INPUT)
  await transitionRuntimeBinding(ADMIN, b.id, 'verify')
  await transitionRuntimeBinding(ADMIN, b.id, 'approve')
  return transitionRuntimeBinding(ADMIN, b.id, 'activate')
}

const SECRETISH = /cred:|payer:|endpoint:|sk-|token|secret|prompt/i

beforeEach(() => {
  db.state.bindings.length = 0
  db.state.revisions.length = 0
  db.state.audits.length = 0
  db.state.lists.length = 0
  db.state.taskLists.clear()
  db.state.lists.push(list('board-1'), list('board-2'), list('board-3'))
  process.env[FLAG] = 'true'
})

afterEach(() => {
  delete process.env[FLAG]
})

describe('AWTD-1668 deployment gate', () => {
  it('refuses enrollment unless the deployment is single-business (default off)', async () => {
    delete process.env[FLAG]
    await expectRefusal(createRuntimeBinding(ADMIN, INPUT), 'deployment-not-single-business')
    process.env[FLAG] = 'false'
    await expectRefusal(createRuntimeBinding(ADMIN, INPUT), 'deployment-not-single-business')
    expect(db.state.bindings).toHaveLength(0)
  })

  it('still lets an admin stop a binding after the gate is turned off', async () => {
    const b = await activeBinding()
    delete process.env[FLAG]
    await expectRefusal(transitionRuntimeBinding(ADMIN, b.id, 'activate'), 'deployment-not-single-business')
    const suspended = await transitionRuntimeBinding(ADMIN, b.id, 'suspend')
    expect(suspended.state).toBe('suspended')
    const revoked = await transitionRuntimeBinding(ADMIN, b.id, 'revoke')
    expect(revoked.state).toBe('revoked')
  })
})

describe('AWTD-1668 admin only', () => {
  it('refuses a non-admin for every operation', async () => {
    const intruder = { userId: 'member-1' }
    await expectRefusal(createRuntimeBinding(intruder, INPUT), 'admin-required')
    await expectRefusal(listRuntimeBindings(intruder), 'admin-required')
    const b = await createRuntimeBinding(ADMIN, INPUT)
    await expectRefusal(transitionRuntimeBinding(intruder, b.id, 'verify'), 'admin-required')
    await expectRefusal(updateRuntimeBinding(intruder, b.id, { maxConcurrentRuns: 1 }), 'admin-required')
    await expectRefusal(attachBoardToRuntimeBinding(intruder, b.id, 'board-1'), 'admin-required')
  })
})

describe('AWTD-1668 lifecycle', () => {
  it('create → verify → approve → activate, with an immutable snapshot and approvedRevision', async () => {
    const created = await createRuntimeBinding(ADMIN, INPUT)
    expect(created).toMatchObject({ state: 'pending', revision: 1, enrolledBy: 'admin-1', ownerUserId: 'admin-1' })
    expect(db.state.revisions).toHaveLength(1)

    const verified = await transitionRuntimeBinding(ADMIN, created.id, 'verify')
    expect(verified.state).toBe('verified')
    expect(verified.verifiedAt).toBeInstanceOf(Date)

    const approved = await transitionRuntimeBinding(ADMIN, created.id, 'approve')
    expect(approved).toMatchObject({ state: 'verified', approvedBy: 'admin-1', approvedRevision: 1 })

    const active = await transitionRuntimeBinding(ADMIN, created.id, 'activate')
    expect(active.state).toBe('active')

    expect(db.state.audits.map(a => a.eventType)).toEqual(['enrolled', 'verified', 'approved', 'activated'])
    expect(db.state.audits.every(a => a.bindingId === created.id && a.actorUserId === 'admin-1')).toBe(true)
    expect(db.state.audits.find(a => a.eventType === 'approved')?.details).toMatchObject({ selfApproval: true })
  })

  it('verify refuses a configuration the resolver would deny', async () => {
    const b = await createRuntimeBinding(ADMIN, { ...INPUT, transport: 'signed-webhook' })
    await expectRefusal(transitionRuntimeBinding(ADMIN, b.id, 'verify'), 'pilot-limit')
    expect(db.state.bindings[0].state).toBe('pending')
  })

  it('a stale expectedRevision is a conflict, not a silent overwrite', async () => {
    const b = await createRuntimeBinding(ADMIN, INPUT)
    await expectRefusal(transitionRuntimeBinding(ADMIN, b.id, 'verify', 7), 'revision-conflict')
  })

  it('unknown binding is not-found', async () => {
    await expectRefusal(transitionRuntimeBinding(ADMIN, 'nope', 'verify'), 'not-found')
  })
})

describe('AWTD-1668 re-approval on broadening', () => {
  it('broadening an active binding writes a new revision and returns it to pending', async () => {
    const b = await activeBinding()
    const changed = await updateRuntimeBinding(ADMIN, b.id, { allowedAgentIds: ['claude', 'codex'] })
    expect(changed).toMatchObject({ state: 'pending', revision: 2, approvedRevision: 1 })
    expect(db.state.revisions.map(r => r.revision)).toEqual([1, 2])
    const audit = db.state.audits.at(-1)!
    expect(audit).toMatchObject({ eventType: 'revision-created', bindingRevision: 2 })
    expect(audit.details).toMatchObject({ reapprovalRequired: true, broadenedFields: ['allowedAgentIds'], previousState: 'active' })

    // Not usable until verified, approved and activated again.
    await expectRefusal(transitionRuntimeBinding(ADMIN, b.id, 'activate'), 'transition-not-allowed')
    await transitionRuntimeBinding(ADMIN, b.id, 'verify')
    await expectRefusal(transitionRuntimeBinding(ADMIN, b.id, 'activate'), 'revision-unapproved')
    await transitionRuntimeBinding(ADMIN, b.id, 'approve')
    const again = await transitionRuntimeBinding(ADMIN, b.id, 'activate')
    expect(again).toMatchObject({ state: 'active', approvedRevision: 2 })
  })

  it('narrowing writes a new revision and carries the approval forward', async () => {
    const b = await activeBinding()
    const changed = await updateRuntimeBinding(ADMIN, b.id, { allowedBoardIds: ['board-1'] })
    expect(changed).toMatchObject({ state: 'active', revision: 2, approvedRevision: 2 })
    expect(db.state.audits.at(-1)?.details).toMatchObject({ reapprovalRequired: false, approvalCarried: true })
  })

  it('an update that changes nothing is refused', async () => {
    const b = await createRuntimeBinding(ADMIN, INPUT)
    await expectRefusal(updateRuntimeBinding(ADMIN, b.id, { maxConcurrentRuns: 1 }), 'no-change')
  })

  it('a revoked binding cannot be changed', async () => {
    const b = await createRuntimeBinding(ADMIN, INPUT)
    await transitionRuntimeBinding(ADMIN, b.id, 'revoke')
    await expectRefusal(updateRuntimeBinding(ADMIN, b.id, { allowedBoardIds: ['board-1'] }), 'binding-revoked')
  })
})

describe('AWTD-1668 attach / detach', () => {
  it('attaches an allowed board, audited, and detaches it again', async () => {
    const b = await activeBinding()
    await attachBoardToRuntimeBinding(ADMIN, b.id, 'board-1')
    expect(db.state.lists.find(l => l.id === 'board-1')?.runtimeBindingId).toBe(b.id)
    expect(db.state.audits.at(-1)).toMatchObject({ eventType: 'board-attached', boardIds: ['board-1'] })

    await detachBoardFromRuntimeBinding(ADMIN, b.id, 'board-1')
    expect(db.state.lists.find(l => l.id === 'board-1')?.runtimeBindingId).toBeNull()
    expect(db.state.audits.at(-1)).toMatchObject({ eventType: 'board-detached', boardIds: ['board-1'] })
  })

  it('refuses a board the binding does not allow', async () => {
    const b = await activeBinding()
    await expectRefusal(attachBoardToRuntimeBinding(ADMIN, b.id, 'board-3'), 'board-not-allowed')
  })

  it('refuses when the admin cannot manage the board', async () => {
    db.state.lists[0] = list('board-1', { ownerId: 'someone-else' })
    const b = await activeBinding()
    await expectRefusal(attachBoardToRuntimeBinding(ADMIN, b.id, 'board-1'), 'board-manage-required')
  })

  it('refuses a board already bound to another binding', async () => {
    const b = await activeBinding()
    db.state.lists[0].runtimeBindingId = 'other-binding'
    await expectRefusal(attachBoardToRuntimeBinding(ADMIN, b.id, 'board-1'), 'board-bound-elsewhere')
  })

  it('HOLDS a conflict: a shared task on a board bound elsewhere refuses the attach and says why', async () => {
    const b = await activeBinding()
    db.state.lists[1].runtimeBindingId = 'other-binding' // board-2
    db.state.taskLists.set('task-1', ['board-1', 'board-2'])
    const attempt = attachBoardToRuntimeBinding(ADMIN, b.id, 'board-1')
    await expectRefusal(attempt, 'board-conflict')
    await attempt.catch((err: RuntimeBindingEnrollmentError) => {
      expect(err.message).toMatch(/Board board-2/)
      expect(err.details).toMatchObject({ conflictingBoards: [{ id: 'board-2', runtimeBindingId: 'other-binding' }] })
    })
    expect(db.state.lists[0].runtimeBindingId).toBeNull()
    expect(db.state.audits.at(-1)).toMatchObject({ eventType: 'board-attach-held', reasonCode: 'board-conflict' })
  })

  it('shared tasks with a board on the SAME binding agree, so the attach goes ahead', async () => {
    const b = await activeBinding()
    await attachBoardToRuntimeBinding(ADMIN, b.id, 'board-2')
    db.state.taskLists.set('task-1', ['board-1', 'board-2'])
    await attachBoardToRuntimeBinding(ADMIN, b.id, 'board-1')
    expect(db.state.lists[0].runtimeBindingId).toBe(b.id)
  })

  it('refuses to attach to a revoked binding, and to narrow away an attached board', async () => {
    const b = await activeBinding()
    await attachBoardToRuntimeBinding(ADMIN, b.id, 'board-1')
    await expectRefusal(updateRuntimeBinding(ADMIN, b.id, { allowedBoardIds: ['board-2'] }), 'board-still-attached')
    await transitionRuntimeBinding(ADMIN, b.id, 'revoke')
    await expectRefusal(attachBoardToRuntimeBinding(ADMIN, b.id, 'board-2'), 'binding-revoked')
  })
})

describe('AWTD-1668 audit rows carry no secrets', () => {
  it('no audit row contains a reference value or prompt-shaped field', async () => {
    const b = await activeBinding()
    await updateRuntimeBinding(ADMIN, b.id, { credentialRef: 'cred:build-01:gen2', billingAccountRef: 'payer:acme-2' })
    await transitionRuntimeBinding(ADMIN, b.id, 'verify')
    await transitionRuntimeBinding(ADMIN, b.id, 'approve')
    await transitionRuntimeBinding(ADMIN, b.id, 'activate')
    await attachBoardToRuntimeBinding(ADMIN, b.id, 'board-1')
    await transitionRuntimeBinding(ADMIN, b.id, 'revoke')

    expect(db.state.audits.length).toBeGreaterThanOrEqual(9)
    for (const row of db.state.audits) {
      expect(JSON.stringify(row)).not.toMatch(SECRETISH)
    }
    // The change is still visible by field name.
    expect(db.state.audits.find(a => a.eventType === 'revision-created')?.details).toMatchObject({
      changedFields: ['billingAccountRef', 'credentialRef'],
    })
  })
})
