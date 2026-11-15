/**
 * Admin enrollment of business runtime bindings (AWTD-1668).
 *
 * Design: docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §6 (enrollment) and
 * §7 (audit). Jon's decisions (2026-11-14):
 *
 *  - Board-level opt-in on a DEDICATED SINGLE-BUSINESS deployment only. Nothing
 *    here runs unless ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS=true, so astrid.cc
 *    refuses enrollment by default. Suspend, revoke and detach stay available
 *    with the gate off: stopping a binding must never be blocked.
 *  - ONE trusted execution board, with agreement among all bound boards.
 *    Conflicts are HELD: an attach that would put one task on boards bound to
 *    different bindings is refused, with the boards named. Nothing picks the
 *    first list.
 *
 * Every operation is admin-only (lib/admin-auth.ts), and attaching or detaching
 * a board also needs management of that board (lib/list-permissions.ts), as
 * RFC §6 requires. Every step writes a RuntimeBindingAuditEvent in the same
 * transaction as the change (lib/runtime-binding/audit.ts).
 *
 * Writes are conditional on the revision and state that were read, so two
 * admins racing get one success and one 409, never a lost update.
 *
 * NOT here (later tasks): a real runtime liveness challenge for `verify` (today
 * it is an admin attestation plus the pilot-limit check), custodian and payer
 * acceptance and credential rotation. Audit retention/export is AWTD-1670.
 */

import type { Prisma, RuntimeBinding } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AdminAuthError, requireAdmin } from '@/lib/admin-auth'
import { canUserManageList, PROJECT_ACCESS_INCLUDE } from '@/lib/list-permissions'
import { runtimeBindingEnrollmentEnabled } from '@/lib/env'
import { recordRuntimeBindingAudit, type RuntimeBindingAuditEventType } from '@/lib/runtime-binding/audit'
import {
  STOPPING_ACTIONS,
  availableActions,
  classifyBindingChange,
  configOf,
  parseCreateInput,
  parseUpdateInput,
  pilotConfigurationProblems,
  planTransition,
  snapshotOf,
  snapshotsEqual,
  type RuntimeBindingAction,
  type RuntimeBindingConfig,
} from '@/lib/runtime-binding/enrollment-rules'

export type EnrollmentErrorCode =
  | 'deployment-not-single-business'
  | 'admin-required'
  | 'invalid-input'
  | 'not-found'
  | 'revision-conflict'
  | 'transition-not-allowed'
  | 'revision-unapproved'
  | 'already-approved'
  | 'pilot-limit'
  | 'snapshot-mismatch'
  | 'no-change'
  | 'binding-revoked'
  | 'board-still-attached'
  | 'board-not-found'
  | 'board-not-allowed'
  | 'board-manage-required'
  | 'board-bound-elsewhere'
  | 'board-conflict'
  | 'board-not-attached'

const STATUS: Record<EnrollmentErrorCode, number> = {
  'deployment-not-single-business': 403,
  'admin-required': 403,
  'invalid-input': 400,
  'not-found': 404,
  'revision-conflict': 409,
  'transition-not-allowed': 409,
  'revision-unapproved': 409,
  'already-approved': 409,
  'pilot-limit': 422,
  'snapshot-mismatch': 409,
  'no-change': 400,
  'binding-revoked': 409,
  'board-still-attached': 409,
  'board-not-found': 404,
  'board-not-allowed': 409,
  'board-manage-required': 403,
  'board-bound-elsewhere': 409,
  'board-conflict': 409,
  'board-not-attached': 409,
}

/** A refusal with a machine-readable code. Messages are operator-facing diagnostics. */
export class RuntimeBindingEnrollmentError extends Error {
  readonly code: EnrollmentErrorCode
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(code: EnrollmentErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'RuntimeBindingEnrollmentError'
    this.code = code
    this.status = STATUS[code]
    this.details = details
  }

  /** The wire shape: the explanation is meant for the admin, so it is sent. */
  toResponseBody() {
    return { error: this.message, code: this.code, ...(this.details ? { details: this.details } : {}) }
  }
}

export interface EnrollmentActor {
  userId: string
}

type Tx = Prisma.TransactionClient

// ── Guards ───────────────────────────────────────────────────────────────────

async function assertAdmin(actor: EnrollmentActor): Promise<void> {
  try {
    await requireAdmin(actor.userId)
  } catch (err) {
    if (err instanceof AdminAuthError) {
      throw new RuntimeBindingEnrollmentError('admin-required', 'Runtime bindings are managed by deployment admins only.')
    }
    throw err
  }
}

function assertSingleBusinessDeployment(): void {
  if (!runtimeBindingEnrollmentEnabled()) {
    throw new RuntimeBindingEnrollmentError(
      'deployment-not-single-business',
      'Runtime binding enrollment is only available on a dedicated single-business deployment ' +
        '(ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS is not enabled here).',
    )
  }
}

async function loadBinding(db: Tx | typeof prisma, id: string): Promise<RuntimeBinding> {
  const row = await db.runtimeBinding.findUnique({ where: { id } })
  if (!row) throw new RuntimeBindingEnrollmentError('not-found', 'No runtime binding has that id.')
  return row
}

function assertExpectedRevision(row: RuntimeBinding, expectedRevision?: number): void {
  if (expectedRevision !== undefined && expectedRevision !== row.revision) {
    throw new RuntimeBindingEnrollmentError(
      'revision-conflict',
      `The binding is at revision ${row.revision}, not ${expectedRevision}. Reload and try again.`,
      { currentRevision: row.revision },
    )
  }
}

/** Write conditionally on what was read; a lost race is a 409. */
async function guardedUpdate(tx: Tx, row: RuntimeBinding, data: Prisma.RuntimeBindingUpdateManyMutationInput) {
  const { count } = await tx.runtimeBinding.updateMany({
    where: { id: row.id, revision: row.revision, state: row.state },
    data,
  })
  if (count !== 1) {
    throw new RuntimeBindingEnrollmentError('revision-conflict', 'The binding changed while this was being saved. Reload and try again.')
  }
  return loadBinding(tx, row.id)
}

/** A scope summary for the audit trail: shape, never reference values. */
function scopeSummary(config: RuntimeBindingConfig) {
  return {
    managementScope: config.managementScope,
    runtimeKind: config.runtimeKind,
    transport: config.transport,
    maxConcurrentRuns: config.maxConcurrentRuns,
    billingSource: config.billingSource,
    allowedAgentIds: [...config.allowedAgentIds].sort(),
    boardCount: config.allowedBoardIds.length,
    repositoryCount: config.allowedRepositoryRefs.length,
    hasCustodian: !!config.runtimeCustodianUserId,
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface RuntimeBindingView {
  binding: RuntimeBinding
  attachedBoards: Array<{ id: string; name: string }>
  availableActions: RuntimeBindingAction[]
}

export async function listRuntimeBindings(actor: EnrollmentActor): Promise<{
  enrollmentEnabled: boolean
  bindings: RuntimeBindingView[]
}> {
  await assertAdmin(actor)
  const bindings = await prisma.runtimeBinding.findMany({ orderBy: { createdAt: 'desc' } })
  const boards = bindings.length
    ? await prisma.taskList.findMany({
        where: { runtimeBindingId: { in: bindings.map(b => b.id) } },
        select: { id: true, name: true, runtimeBindingId: true },
      })
    : []
  return {
    enrollmentEnabled: runtimeBindingEnrollmentEnabled(),
    bindings: bindings.map(binding => ({
      binding,
      attachedBoards: boards.filter(b => b.runtimeBindingId === binding.id).map(({ id, name }) => ({ id, name })),
      availableActions: availableActions(binding),
    })),
  }
}

export async function getRuntimeBinding(actor: EnrollmentActor, id: string) {
  await assertAdmin(actor)
  const binding = await loadBinding(prisma, id)
  const [boards, revisions] = await Promise.all([
    prisma.taskList.findMany({ where: { runtimeBindingId: id }, select: { id: true, name: true } }),
    prisma.runtimeBindingRevision.findMany({ where: { bindingId: id }, orderBy: { revision: 'desc' } }),
  ])
  return { binding, attachedBoards: boards, revisions, availableActions: availableActions(binding) }
}

// ── Create and change ────────────────────────────────────────────────────────

export async function createRuntimeBinding(actor: EnrollmentActor, raw: unknown): Promise<RuntimeBinding> {
  await assertAdmin(actor)
  assertSingleBusinessDeployment()
  const parsed = parseCreateInput(raw)
  if (!parsed.ok) {
    throw new RuntimeBindingEnrollmentError('invalid-input', 'The runtime binding is not valid.', { problems: parsed.problems })
  }
  const { ownerUserId, ...input } = parsed.value
  const config = configOf(input)

  return prisma.$transaction(async tx => {
    const binding = await tx.runtimeBinding.create({
      data: { ...config, ownerUserId: ownerUserId ?? actor.userId, enrolledBy: actor.userId, state: 'pending', revision: 1 },
    })
    await tx.runtimeBindingRevision.create({
      data: { bindingId: binding.id, revision: 1, snapshot: snapshotOf(config) as Prisma.InputJsonValue, createdByUserId: actor.userId },
    })
    await recordRuntimeBindingAudit(tx, {
      bindingId: binding.id,
      bindingRevision: 1,
      eventType: 'enrolled',
      actorUserId: actor.userId,
      boardIds: config.allowedBoardIds,
      repositoryRefs: config.allowedRepositoryRefs,
      details: { scope: scopeSummary(config), ownerUserId: binding.ownerUserId },
    })
    return binding
  })
}

/**
 * Change a binding's configuration. Every change is a new immutable revision.
 * A broadening returns the binding to `pending` (verify, approve and activate
 * again); a pure narrowing keeps its state and carries the approval forward.
 */
export async function updateRuntimeBinding(
  actor: EnrollmentActor,
  id: string,
  raw: unknown,
  expectedRevision?: number,
): Promise<RuntimeBinding> {
  await assertAdmin(actor)
  assertSingleBusinessDeployment()
  const parsed = parseUpdateInput(raw)
  if (!parsed.ok) {
    throw new RuntimeBindingEnrollmentError('invalid-input', 'The runtime binding change is not valid.', { problems: parsed.problems })
  }

  return prisma.$transaction(async tx => {
    const row = await loadBinding(tx, id)
    assertExpectedRevision(row, expectedRevision)
    if (row.state === 'revoked') {
      throw new RuntimeBindingEnrollmentError('binding-revoked', 'A revoked runtime binding cannot be changed. Enroll a new one.')
    }
    const prev = configOf(row)
    const next = configOf({ ...prev, ...parsed.value })
    const { changed, broadened } = classifyBindingChange(prev, next)
    if (changed.length === 0) throw new RuntimeBindingEnrollmentError('no-change', 'Nothing in the binding would change.')

    const removedBoards = prev.allowedBoardIds.filter(b => !next.allowedBoardIds.includes(b))
    if (removedBoards.length) {
      const stillAttached = await tx.taskList.findMany({
        where: { id: { in: removedBoards }, runtimeBindingId: id },
        select: { id: true, name: true },
      })
      if (stillAttached.length) {
        throw new RuntimeBindingEnrollmentError(
          'board-still-attached',
          `Detach ${stillAttached.map(b => b.name).join(', ')} before removing it from the binding.`,
          { boardIds: stillAttached.map(b => b.id) },
        )
      }
    }

    const revision = row.revision + 1
    const reapprovalRequired = broadened.length > 0
    const wasApproved = !!row.approvedBy && row.approvedRevision === row.revision
    const approvalCarried = !reapprovalRequired && wasApproved
    const state = reapprovalRequired && row.state !== 'pending' ? 'pending' : row.state

    await tx.runtimeBindingRevision.create({
      data: { bindingId: id, revision, snapshot: snapshotOf(next) as Prisma.InputJsonValue, createdByUserId: actor.userId },
    })
    const updated = await guardedUpdate(tx, row, {
      ...parsed.value,
      revision,
      state,
      ...(approvalCarried ? { approvedRevision: revision } : {}),
    })
    await recordRuntimeBindingAudit(tx, {
      bindingId: id,
      bindingRevision: revision,
      eventType: 'revision-created',
      actorUserId: actor.userId,
      boardIds: next.allowedBoardIds,
      repositoryRefs: next.allowedRepositoryRefs,
      reasonCode: reapprovalRequired ? 'broadened' : 'narrowed',
      details: {
        changedFields: [...changed].sort(),
        broadenedFields: [...broadened].sort(),
        reapprovalRequired,
        approvalCarried,
        previousRevision: row.revision,
        previousState: row.state,
        previousScope: scopeSummary(prev),
        scope: scopeSummary(next),
      },
    })
    return updated
  })
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Every one is classified in lib/runtime-binding/audit-retention.ts (the type enforces it). */
const EVENT_FOR: Record<RuntimeBindingAction, RuntimeBindingAuditEventType> = {
  verify: 'verified',
  approve: 'approved',
  activate: 'activated',
  suspend: 'suspended',
  revoke: 'revoked',
}

export async function transitionRuntimeBinding(
  actor: EnrollmentActor,
  id: string,
  action: RuntimeBindingAction,
  expectedRevision?: number,
): Promise<RuntimeBinding> {
  await assertAdmin(actor)
  if (!STOPPING_ACTIONS.has(action)) assertSingleBusinessDeployment()

  return prisma.$transaction(async tx => {
    const row = await loadBinding(tx, id)
    assertExpectedRevision(row, expectedRevision)
    const plan = planTransition(row, action)
    if (!plan.ok) throw new RuntimeBindingEnrollmentError(plan.code, plan.message)

    const config = configOf(row)
    if (action === 'verify' || action === 'activate') {
      const problems = pilotConfigurationProblems(config)
      if (problems.length) {
        throw new RuntimeBindingEnrollmentError(
          'pilot-limit',
          `The binding is outside the pilot limits, so it could never run: ${problems.join(', ')}.`,
          { problems },
        )
      }
    }

    const now = new Date()
    const details: Record<string, unknown> = { previousState: row.state }
    let data: Prisma.RuntimeBindingUpdateManyMutationInput = { state: plan.to }

    switch (action) {
      case 'verify':
        // An admin attestation today; a bounded liveness challenge is a later task.
        data = { ...data, verifiedAt: now }
        details.method = 'admin-attestation'
        break
      case 'approve': {
        // The approval covers exactly this revision's immutable snapshot.
        const snapshot = snapshotOf(config)
        const existing = await tx.runtimeBindingRevision.findUnique({
          where: { bindingId_revision: { bindingId: id, revision: row.revision } },
        })
        if (existing && !snapshotsEqual(existing.snapshot, snapshot)) {
          throw new RuntimeBindingEnrollmentError(
            'snapshot-mismatch',
            `Revision ${row.revision}'s snapshot does not match the binding, so it cannot be approved.`,
          )
        }
        if (!existing) {
          await tx.runtimeBindingRevision.create({
            data: { bindingId: id, revision: row.revision, snapshot: snapshot as Prisma.InputJsonValue, createdByUserId: actor.userId },
          })
        }
        data = { ...data, approvedBy: actor.userId, approvedRevision: row.revision, approvedAt: now }
        // One admin may approve their own enrollment; it is recorded as such (RFC §6).
        details.selfApproval = row.enrolledBy === actor.userId
        details.scope = scopeSummary(config)
        break
      }
      case 'activate':
        data = { ...data, activatedAt: now }
        details.resumed = row.state === 'suspended'
        break
      case 'suspend':
        data = { ...data, suspendedAt: now }
        break
      case 'revoke':
        // Boards stay attached so the resolver keeps DENYING them, never
        // reading a revoked board as legacy (RFC §10 rollback).
        data = { ...data, revokedAt: now }
        break
    }

    const updated = await guardedUpdate(tx, row, data)
    await recordRuntimeBindingAudit(tx, {
      bindingId: id,
      bindingRevision: row.revision,
      // Leaving suspension is its own event, so the trail says the binding resumed.
      eventType: action === 'activate' && row.state === 'suspended' ? 'resumed' : EVENT_FOR[action],
      actorUserId: actor.userId,
      boardIds: config.allowedBoardIds,
      details,
    })
    return updated
  })
}

// ── Boards ───────────────────────────────────────────────────────────────────

async function loadManagedBoard(tx: Tx, actor: EnrollmentActor, boardId: string) {
  const board = await tx.taskList.findUnique({
    where: { id: boardId },
    include: { listMembers: { select: { userId: true, role: true } }, ...PROJECT_ACCESS_INCLUDE },
  })
  if (!board) throw new RuntimeBindingEnrollmentError('board-not-found', 'No board has that id.')
  if (!canUserManageList({ id: actor.userId }, board as never)) {
    throw new RuntimeBindingEnrollmentError(
      'board-manage-required',
      `You need to manage ${board.name} to change its runtime binding.`,
    )
  }
  return board
}

/**
 * Bind a board to this binding. HOLDS conflicts rather than resolving them: if
 * any task on this board also sits on a board bound to a different binding,
 * the bound boards would disagree about which runtime runs it, so the attach is
 * refused and the conflicting boards are named. The hold is audited.
 */
export async function attachBoardToRuntimeBinding(actor: EnrollmentActor, id: string, boardId: string) {
  await assertAdmin(actor)
  assertSingleBusinessDeployment()

  const held = await prisma.$transaction(async tx => {
    const row = await loadBinding(tx, id)
    if (row.state === 'revoked') {
      throw new RuntimeBindingEnrollmentError('binding-revoked', 'A revoked runtime binding cannot take boards.')
    }
    if (!row.allowedBoardIds.includes(boardId)) {
      throw new RuntimeBindingEnrollmentError(
        'board-not-allowed',
        'That board is not in the binding\'s allowed boards. Add it (which needs re-approval) first.',
      )
    }
    const board = await loadManagedBoard(tx, actor, boardId)
    if (board.runtimeBindingId === id) return null
    if (board.runtimeBindingId) {
      throw new RuntimeBindingEnrollmentError(
        'board-bound-elsewhere',
        `${board.name} is already bound to another runtime binding. Detach it there first.`,
        { runtimeBindingId: board.runtimeBindingId },
      )
    }

    const conflicting = await tx.taskList.findMany({
      where: {
        id: { not: boardId },
        AND: [{ runtimeBindingId: { not: null } }, { runtimeBindingId: { not: id } }],
        tasks: { some: { lists: { some: { id: boardId } } } },
      },
      select: { id: true, name: true, runtimeBindingId: true },
      take: 10,
    })
    if (conflicting.length) {
      return { row, board, conflicting }
    }

    // Conditional on the board still being unbound: a concurrent attach loses.
    const { count } = await tx.taskList.updateMany({
      where: { id: boardId, runtimeBindingId: null },
      data: { runtimeBindingId: id },
    })
    if (count !== 1) {
      throw new RuntimeBindingEnrollmentError('revision-conflict', `${board.name} changed while this was being saved. Reload and try again.`)
    }
    await recordRuntimeBindingAudit(tx, {
      bindingId: id,
      bindingRevision: row.revision,
      eventType: 'board-attached',
      actorUserId: actor.userId,
      boardIds: [boardId],
      details: { bindingState: row.state },
    })
    return null
  })

  if (held) {
    const { row, board, conflicting } = held
    // Recorded outside the refused transaction, so the hold survives the refusal.
    await recordRuntimeBindingAudit(prisma, {
      bindingId: id,
      bindingRevision: row.revision,
      eventType: 'board-attach-held',
      actorUserId: actor.userId,
      boardIds: [boardId, ...conflicting.map(b => b.id)],
      reasonCode: 'board-conflict',
      details: { conflictingBindingIds: [...new Set(conflicting.map(b => b.runtimeBindingId))] },
    })
    throw new RuntimeBindingEnrollmentError(
      'board-conflict',
      `${board.name} shares tasks with ${conflicting.map(b => b.name).join(', ')}, which ` +
        `${conflicting.length === 1 ? 'is' : 'are'} bound to a different runtime binding. Every bound board on a task ` +
        'must agree on one binding, so this attach is held. Move those tasks or bind the boards to the same binding first.',
      { conflictingBoards: conflicting },
    )
  }
}

/** Unbind a board. Always allowed for an admin who manages it, even with the gate off. */
export async function detachBoardFromRuntimeBinding(actor: EnrollmentActor, id: string, boardId: string) {
  await assertAdmin(actor)
  await prisma.$transaction(async tx => {
    const row = await loadBinding(tx, id)
    const board = await loadManagedBoard(tx, actor, boardId)
    if (board.runtimeBindingId !== id) {
      throw new RuntimeBindingEnrollmentError('board-not-attached', `${board.name} is not bound to this runtime binding.`)
    }
    const { count } = await tx.taskList.updateMany({
      where: { id: boardId, runtimeBindingId: id },
      data: { runtimeBindingId: null },
    })
    if (count !== 1) {
      throw new RuntimeBindingEnrollmentError('revision-conflict', `${board.name} changed while this was being saved. Reload and try again.`)
    }
    await recordRuntimeBindingAudit(tx, {
      bindingId: id,
      bindingRevision: row.revision,
      eventType: 'board-detached',
      actorUserId: actor.userId,
      boardIds: [boardId],
      details: { bindingState: row.state },
    })
  })
}
