import { isBrandAgentEmail } from '@/lib/brand/agent-emails'
import type { AuthContext } from '@/lib/api-auth-middleware'
import type { RuntimeBindingDenial } from '@/lib/ai/runtime-binding-resolver'
import { DOING_STATUS_ROLE } from '@/lib/task-status'

export const AGENT_TASK_CLAIM_ACTIONS = ['claim', 'resume', 'release', 'heartbeat'] as const

export type AgentTaskClaimAction = typeof AGENT_TASK_CLAIM_ACTIONS[number]

export interface AgentTaskClaimRequest {
  action: AgentTaskClaimAction
  agentMailbox?: string
  /** Lease length for `claim` and `heartbeat` (AWTD-1688); the default when absent. */
  leaseSeconds?: number
}

/**
 * The claim lease (AWTD-1688). A claim holds the task for this long; the holder
 * renews it with `heartbeat`, and once it passes the waiting-settle cron returns
 * the task to Ready (services/agent-claim-lease.service.ts). Long enough that a
 * heartbeat every few minutes never races it, short enough that a dead run is
 * back in Ready within a quarter of an hour plus one five-minute cron tick.
 */
export const AGENT_CLAIM_LEASE_DEFAULT_SECONDS = 15 * 60
export const AGENT_CLAIM_LEASE_MIN_SECONDS = 60
export const AGENT_CLAIM_LEASE_MAX_SECONDS = 60 * 60

/** When a lease taken or renewed at `now` runs out. */
export function claimLeaseExpiry(now: Date, leaseSeconds = AGENT_CLAIM_LEASE_DEFAULT_SECONDS): Date {
  return new Date(now.getTime() + leaseSeconds * 1000)
}

/** Has this lease run out? No lease never expires. */
export function isClaimLeaseExpired(
  task: { claimLeaseExpiresAt: Date | null },
  now: Date,
): boolean {
  return task.claimLeaseExpiresAt !== null && task.claimLeaseExpiresAt.getTime() <= now.getTime()
}

export interface ExpiredLeaseTask {
  statusRole: string | null
  completed: boolean
  assigneeId: string | null
  assigneeIds: string[]
  claimHolderId: string | null
  /** Any of the task's boards has agentClaimRequired on. */
  enrolled: boolean
}

export type ExpiredLeaseDecision =
  /** The holder still owns it in Doing: back to Ready, with these assignees. */
  | { kind: 'release'; assigneeId: string | null; assigneeIds: string[] }
  /** It moved on (done, another lane, another owner): only the lease goes. */
  | { kind: 'clear' }

/**
 * What an expired lease does (AWTD-1688). Only a task its holder still owns in
 * Doing is released, so a person who moved or reassigned it in the meantime is
 * never overridden. On an enrolled board the holder took it from the
 * unassigned pool and is unassigned so any agent can claim it again; elsewhere
 * the assignment stays, as scripts/lib/doing-release.ts keeps it, so the same
 * agent's queue picks it up on its next run.
 */
export function decideExpiredLease(task: ExpiredLeaseTask): ExpiredLeaseDecision {
  const holder = task.claimHolderId
  if (!holder || task.completed || task.statusRole !== DOING_STATUS_ROLE || task.assigneeId !== holder) {
    return { kind: 'clear' }
  }
  if (!task.enrolled) {
    return { kind: 'release', assigneeId: task.assigneeId, assigneeIds: [...task.assigneeIds] }
  }
  const assigneeIds = task.assigneeIds.filter(id => id !== holder)
  return { kind: 'release', assigneeId: assigneeIds[0] ?? null, assigneeIds }
}

/** The note an expiry leaves on the task: why it is back in Ready. */
export function expiredLeaseComment(lastHeartbeat: Date | null, expiredAt: Date): string {
  const since = lastHeartbeat ? ` since ${lastHeartbeat.toISOString()}` : ''
  return `🔁 Returned to Ready: the agent that claimed this task sent no heartbeat${since}, and its claim lease expired at ${expiredAt.toISOString()}.`
}

export type AgentTaskClaimOutcome =
  | 'claimed'
  | 'already_yours'
  | 'released'
  /** A `heartbeat` renewed the holder's lease (AWTD-1688). */
  | 'renewed'
  | 'conflict'
  | 'not_ready'
  | 'not_found'
  | 'forbidden'
  /** A bound board refused the claim (AWTD-1669); `binding` says why. */
  | 'binding_denied'

export interface AgentTaskClaimTask {
  id: string
  statusRole: string | null
  completed: boolean
  assigneeId: string | null
  assigneeIds: string[]
  updatedAt: Date
  /** The lease end (AWTD-1688); null when the task carries none. */
  claimLeaseExpiresAt: Date | null
}

export interface AgentTaskClaimResult {
  outcome: AgentTaskClaimOutcome
  task: AgentTaskClaimTask | null
  /** Only with `binding_denied`: identity and reason, never a credential or payer reference. */
  binding?: Pick<RuntimeBindingDenial, 'reason' | 'bindingId' | 'boardId' | 'message'>
}

export interface AgentTaskClaimPrincipal {
  agentId: string
  agentEmail: string
  agentMailbox: string
}

export function parseAgentTaskClaimRequest(body: unknown): AgentTaskClaimRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Claim request must be an object')
  }

  const candidate = body as Record<string, unknown>
  if (Object.keys(candidate).some(key => key !== 'action' && key !== 'agentMailbox' && key !== 'leaseSeconds')) {
    throw new Error('Claim request contains an unsupported field')
  }
  if (
    typeof candidate.action !== 'string' ||
    !AGENT_TASK_CLAIM_ACTIONS.includes(candidate.action as AgentTaskClaimAction)
  ) {
    throw new Error('Claim action must be claim, resume, release, or heartbeat')
  }
  const leaseSeconds = candidate.leaseSeconds
  if (
    leaseSeconds !== undefined &&
    (typeof leaseSeconds !== 'number' ||
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < AGENT_CLAIM_LEASE_MIN_SECONDS ||
      leaseSeconds > AGENT_CLAIM_LEASE_MAX_SECONDS ||
      (candidate.action !== 'claim' && candidate.action !== 'heartbeat'))
  ) {
    throw new Error('leaseSeconds must be a whole number of seconds from 60 to 3600, on claim or heartbeat')
  }

  if (
    candidate.agentMailbox !== undefined &&
    (typeof candidate.agentMailbox !== 'string' || !/^[a-z0-9._-]{1,128}$/i.test(candidate.agentMailbox))
  ) {
    throw new Error('Agent mailbox must be a mailbox name')
  }

  return {
    action: candidate.action as AgentTaskClaimAction,
    ...(typeof candidate.agentMailbox === 'string'
      ? { agentMailbox: candidate.agentMailbox }
      : {}),
    ...(typeof leaseSeconds === 'number' ? { leaseSeconds } : {}),
  }
}

/**
 * Does this credential act for a person rather than an agent, so it may name
 * the agent it claims for (AWTD-1688)? Client-credentials tokens and any other
 * token with no agent binding do; a browser session does not, and a credential
 * bound to an agent may only ever act as that agent.
 */
export function claimsOnBehalfOfAgent(
  auth: Pick<AuthContext, 'agentUser' | 'isAIAgent' | 'source'>,
): boolean {
  return !auth.agentUser && !auth.isAIAgent && auth.source !== 'session'
}

/** Resolve the only agent identity this credential may operate as. */
export function resolveAgentTaskClaimPrincipal(
  auth: Pick<AuthContext, 'agentUser' | 'isAIAgent' | 'user'>,
  requestedMailbox?: string,
): AgentTaskClaimPrincipal | null {
  const identity = auth.agentUser ?? (auth.isAIAgent ? auth.user : null)
  if (!identity?.isAIAgent || !isBrandAgentEmail(identity.email)) return null

  const at = identity.email.lastIndexOf('@')
  const agentMailbox = identity.email.slice(0, at)
  if (!agentMailbox || (requestedMailbox && requestedMailbox.toLowerCase() !== agentMailbox.toLowerCase())) {
    return null
  }

  return {
    agentId: identity.id,
    agentEmail: identity.email,
    agentMailbox,
  }
}
