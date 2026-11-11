import { isBrandAgentEmail } from '@/lib/brand/agent-emails'
import type { AuthContext } from '@/lib/api-auth-middleware'

export const AGENT_TASK_CLAIM_ACTIONS = ['claim', 'resume', 'release'] as const

export type AgentTaskClaimAction = typeof AGENT_TASK_CLAIM_ACTIONS[number]

export interface AgentTaskClaimRequest {
  action: AgentTaskClaimAction
  agentMailbox?: string
}

export type AgentTaskClaimOutcome =
  | 'claimed'
  | 'already_yours'
  | 'released'
  | 'conflict'
  | 'not_ready'
  | 'not_found'
  | 'forbidden'

export interface AgentTaskClaimTask {
  id: string
  statusRole: string | null
  completed: boolean
  assigneeId: string | null
  assigneeIds: string[]
  updatedAt: Date
}

export interface AgentTaskClaimResult {
  outcome: AgentTaskClaimOutcome
  task: AgentTaskClaimTask | null
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
  if (Object.keys(candidate).some(key => key !== 'action' && key !== 'agentMailbox')) {
    throw new Error('Claim request contains an unsupported field')
  }
  if (
    typeof candidate.action !== 'string' ||
    !AGENT_TASK_CLAIM_ACTIONS.includes(candidate.action as AgentTaskClaimAction)
  ) {
    throw new Error('Claim action must be claim, resume, or release')
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
  }
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
