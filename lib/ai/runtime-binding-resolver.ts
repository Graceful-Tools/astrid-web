/**
 * Which runtime runs an agent for a board — the one entry point (AWTD-1667).
 *
 * Design: docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §5 (dual-read
 * contract) and §10 (evidence). Jon's decisions of 2026-11-14 fix the pilot:
 * deployment-business scope only, polling transport at concurrency one, and
 * business-provided credentials and payer only.
 *
 * Three answers, and only three:
 *
 *  - `legacy` — the board has no binding, or ASTRID_RUNTIME_BINDING_RESOLVER is
 *    off. The answer is EXACTLY today's: getAgentExecutionMode for the caller's
 *    chosen user, and resolveAgentRunBilling for the owner candidates. Nothing
 *    is normalised, re-ordered or re-read. With the flag off the binding column
 *    is not even looked at, so no query can happen.
 *  - `bound`  — an active, approved, in-scope binding. The runtime, credential
 *    reference and payer come from the binding, and personal settings are NOT
 *    read: a business run must not depend on, or be able to spend, anyone's
 *    personal key.
 *  - `denied` — a non-null binding that cannot be used, for any reason,
 *    including a failed lookup. A denial is never turned into `legacy`; RFC §5:
 *    "Missing/deleted references, lookup failures, ambiguity and invalid
 *    configuration are explicit denials, not legacy fallback."
 *
 * Enrollment and its audit writes live in lib/runtime-binding/ (AWTD-1668),
 * which holds conflicting attachments rather than creating them. The pilot
 * (AWTD-1669) builds on this per-board answer: multi-board agreement, the
 * runtime-principal check, queue discovery and dispatch gating in
 * lib/runtime-binding/task-runtime.ts, and the fenced capacity lease in
 * lib/runtime-binding/claim-fence.ts. Still not here: repository checks at
 * claim time (the pilot binding's repository allow-list is not consulted).
 */

import type { RuntimeBinding } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { agentMailboxFromEmail } from '@/lib/brand/agent-emails'
import { runtimeBindingResolverEnabled } from '@/lib/env'
import {
  getAgentExecutionMode,
  resolveAgentRunBilling,
  type AgentExecutionMode,
  type AgentRunBilling,
  type AgentRunOwnerCandidates,
} from '@/lib/ai/agent-execution-mode'
import { createLogger } from '@/lib/logger'
import {
  PILOT_BILLING_SOURCE,
  PILOT_MAX_CONCURRENT_RUNS,
  PILOT_SCOPE,
  PILOT_TRANSPORT,
} from '@/lib/runtime-binding/pilot' // shared with enrollment (AWTD-1668)

const log = createLogger('ai.runtime-binding-resolver')

/** The binding columns resolution reads. Never secrets: refs are opaque ids. */
export type RuntimeBindingRecord = Pick<
  RuntimeBinding,
  | 'id'
  | 'revision'
  | 'managementScope'
  | 'runtimeKind'
  | 'runtimeSubjectId'
  | 'allowedAgentIds'
  | 'transport'
  | 'credentialRef'
  | 'allowedRepositoryRefs'
  | 'allowedBoardIds'
  | 'maxConcurrentRuns'
  | 'billingSource'
  | 'billingAccountRef'
  | 'state'
  | 'approvedBy'
  | 'approvedRevision'
>

export const BINDING_SELECT = {
  id: true,
  revision: true,
  managementScope: true,
  runtimeKind: true,
  runtimeSubjectId: true,
  allowedAgentIds: true,
  transport: true,
  credentialRef: true,
  allowedRepositoryRefs: true,
  allowedBoardIds: true,
  maxConcurrentRuns: true,
  billingSource: true,
  billingAccountRef: true,
  state: true,
  approvedBy: true,
  approvedRevision: true,
} as const satisfies Record<keyof RuntimeBindingRecord, true>

export type RuntimeBindingDenialReason =
  | 'binding-missing'
  | 'binding-lookup-failed'
  | 'binding-not-active'
  | 'revision-unapproved'
  | 'scope-not-business'
  | 'board-not-enrolled'
  | 'agent-not-allowed'
  | 'transport-unsupported'
  | 'concurrency-invalid'
  | 'runtime-subject-missing'
  | 'credential-missing'
  | 'payer-not-business'
  | 'payer-missing'
  // Raised by the pilot's task gate and claim fence (AWTD-1669), not by
  // evaluateRuntimeBinding: they need the task, the caller or the occupancy.
  | 'board-conflict'
  | 'principal-not-runtime'
  | 'capacity-exhausted'

/** Operator-facing explanations. Server diagnostics, not UI copy. */
const DENIAL_MESSAGES: Record<RuntimeBindingDenialReason, string> = {
  'binding-missing': 'This board is bound to a runtime binding that does not exist.',
  'binding-lookup-failed': 'This board\'s runtime binding could not be read, so no runtime was chosen.',
  'binding-not-active': 'This board\'s runtime binding is not active.',
  'revision-unapproved': 'This board\'s runtime binding has changes that have not been approved.',
  'scope-not-business': 'Only deployment-business runtime bindings can run work.',
  'board-not-enrolled': 'This board is not enrolled in its runtime binding.',
  'agent-not-allowed': 'This agent is not allowed by the board\'s runtime binding.',
  'transport-unsupported': 'The runtime binding\'s transport is not supported yet; only polling is.',
  'concurrency-invalid': 'The runtime binding\'s concurrency limit must be exactly 1 during the pilot.',
  'runtime-subject-missing': 'The runtime binding names no enrolled runtime.',
  'credential-missing': 'The runtime binding has no business credential.',
  'payer-not-business': 'The runtime binding is not paid for by the business.',
  'payer-missing': 'The runtime binding has no business payer.',
  'board-conflict': 'This task sits on boards that do not agree on one runtime binding, so no runtime was chosen.',
  'principal-not-runtime': 'Only the runtime enrolled in this board\'s runtime binding may take its work.',
  'capacity-exhausted': 'The runtime binding is already running as many tasks as it allows.',
}

export interface RuntimeBindingPlan {
  bindingId: string
  revision: number
  boardId: string
  agentMailbox: string
  runtimeKind: string
  runtimeSubjectId: string
  transport: typeof PILOT_TRANSPORT
  /** Opaque reference for the executor only. Never put it on a queue response. */
  credentialRef: string
  maxConcurrentRuns: number
  payer: { source: typeof PILOT_BILLING_SOURCE; accountRef: string }
}

export type AgentRuntimeResolution =
  | { kind: 'legacy'; mode: AgentExecutionMode; billing?: AgentRunBilling }
  | { kind: 'bound'; mode: 'polling'; plan: RuntimeBindingPlan }
  | RuntimeBindingDenial

export interface RuntimeBindingDenial {
  kind: 'denied'
  bindingId: string
  boardId: string
  reason: RuntimeBindingDenialReason
  message: string
}

/** A denial as an error, for callers that answer over HTTP. */
export class RuntimeBindingDeniedError extends Error {
  readonly reason: RuntimeBindingDenialReason
  readonly bindingId: string
  readonly boardId: string

  constructor(denial: RuntimeBindingDenial) {
    super(denial.message)
    this.name = 'RuntimeBindingDeniedError'
    this.reason = denial.reason
    this.bindingId = denial.bindingId
    this.boardId = denial.boardId
  }
}

export interface ResolveAgentRuntimeInput {
  agentEmail: string | null | undefined
  /**
   * Whose personal settings decide a LEGACY run — today's caller-specific
   * choice, passed through unchanged (the queue passes the caller). Omitted:
   * the run owner from `owners`, as the dispatch sites choose it.
   */
  legacyUserId?: string | null
  /** Owner candidates. When given, a legacy answer carries today's billing. */
  owners?: AgentRunOwnerCandidates
  /** The trusted execution board, with its association as stored. */
  board?: { id: string; runtimeBindingId?: string | null } | null
}

export async function resolveAgentRuntime({
  agentEmail,
  legacyUserId,
  owners,
  board,
}: ResolveAgentRuntimeInput): Promise<AgentRuntimeResolution> {
  const bindingId = runtimeBindingResolverEnabled() ? board?.runtimeBindingId : null
  if (board && bindingId) return resolveBound(bindingId, board.id, agentEmail)

  const billing = owners ? resolveAgentRunBilling(owners) : undefined
  const userId = legacyUserId !== undefined ? legacyUserId : billing?.userId ?? null
  const mode = await getAgentExecutionMode(userId, agentEmail)
  return billing ? { kind: 'legacy', mode, billing } : { kind: 'legacy', mode }
}

async function resolveBound(
  bindingId: string,
  boardId: string,
  agentEmail: string | null | undefined,
): Promise<AgentRuntimeResolution> {
  let row: RuntimeBindingRecord | null
  try {
    row = await prisma.runtimeBinding.findUnique({ where: { id: bindingId }, select: BINDING_SELECT })
  } catch (err) {
    log.warn({ err, bindingId, boardId }, 'runtime binding lookup failed; denying')
    return deny(bindingId, boardId, 'binding-lookup-failed')
  }
  if (!row) return deny(bindingId, boardId, 'binding-missing')
  return evaluateRuntimeBinding(row, boardId, agentEmail)
}

/**
 * Is this binding usable for this board and agent? Pure, so every denial is
 * testable without a database. The checks run in a fixed order and the first
 * failure is the reason reported.
 */
export function evaluateRuntimeBinding(
  binding: RuntimeBindingRecord,
  boardId: string,
  agentEmail: string | null | undefined,
): Exclude<AgentRuntimeResolution, { kind: 'legacy' }> {
  const fail = (reason: RuntimeBindingDenialReason) => deny(binding.id, boardId, reason)
  const mailbox = agentMailboxFromEmail(agentEmail)
  const email = agentEmail?.trim().toLowerCase()

  if (binding.state !== 'active') return fail('binding-not-active')
  if (!present(binding.approvedBy) || binding.approvedRevision !== binding.revision) {
    return fail('revision-unapproved')
  }
  if (binding.managementScope !== PILOT_SCOPE) return fail('scope-not-business')
  if (!binding.allowedBoardIds.includes(boardId)) return fail('board-not-enrolled')
  if (!mailbox || !binding.allowedAgentIds.some(id => id === mailbox || id.toLowerCase() === email)) {
    return fail('agent-not-allowed')
  }
  if (binding.transport !== PILOT_TRANSPORT) return fail('transport-unsupported')
  if (binding.maxConcurrentRuns !== PILOT_MAX_CONCURRENT_RUNS) return fail('concurrency-invalid')
  if (!present(binding.runtimeSubjectId)) return fail('runtime-subject-missing')
  if (!present(binding.credentialRef)) return fail('credential-missing')
  if (binding.billingSource !== PILOT_BILLING_SOURCE) return fail('payer-not-business')
  if (!present(binding.billingAccountRef)) return fail('payer-missing')

  return {
    kind: 'bound',
    mode: 'polling',
    plan: {
      bindingId: binding.id,
      revision: binding.revision,
      boardId,
      agentMailbox: mailbox,
      runtimeKind: binding.runtimeKind,
      runtimeSubjectId: binding.runtimeSubjectId,
      transport: PILOT_TRANSPORT,
      credentialRef: binding.credentialRef,
      maxConcurrentRuns: binding.maxConcurrentRuns,
      payer: { source: PILOT_BILLING_SOURCE, accountRef: binding.billingAccountRef },
    },
  }
}

export function deny(bindingId: string, boardId: string, reason: RuntimeBindingDenialReason): RuntimeBindingDenial {
  return { kind: 'denied', bindingId, boardId, reason, message: DENIAL_MESSAGES[reason] }
}

function present(value: string | null | undefined): value is string {
  return !!value?.trim()
}
