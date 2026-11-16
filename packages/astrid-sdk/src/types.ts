/**
 * Wire types for the agent endpoints the client calls. Each mirrors a server
 * contract in astrid-web; the client adds no fields of its own.
 */

import type { QueueSnapshot } from './verdict.js'

/** `GET /api/v1/agent-queue`. The verdict reads a subset; the rest passes through. */
export interface AgentQueueResponse extends QueueSnapshot {
  /** `polling` or `webhook`/hosted: how the server delivers this agent's work. */
  mode?: string
  truncated?: boolean
  /** Why the server would wake a run; absent on older servers. */
  runnable?: { reasons?: string[]; incomplete?: boolean } | null
  [key: string]: unknown
}

export interface AgentQueueQuery {
  /** Mailbox, e.g. `claude`, or a Custom Agent address. */
  agent: string
  listId?: string
  /** Count unassigned Ready tasks as queued work too (the /fixall rule). */
  includeUnassigned?: boolean
}

/** `POST /api/v1/tasks/:id/claim` (docs/AGENT_CLAIM_API.md). */
export type ClaimAction = 'claim' | 'resume' | 'release'

export type ClaimOutcome =
  | 'claimed'
  | 'already_yours'
  | 'released'
  | 'conflict'
  | 'not_ready'
  | 'not_found'
  | 'forbidden'
  | 'binding_denied'

export interface ClaimTaskSnapshot {
  id: string
  statusRole: string | null
  completed: boolean
  assigneeId: string | null
  assigneeIds: string[]
  updatedAt: string
}

export interface ClaimRequest {
  action: ClaimAction
  /** Confirms the token's bound mailbox; sent as its local part. */
  agentMailbox?: string
}

export interface ClaimResult {
  /** HTTP status. */
  status: number
  /**
   * The server's outcome, or `unavailable` when the route is off or absent
   * (`ASTRID_AGENT_CLAIM_API` unset answers a bare 404).
   */
  outcome: ClaimOutcome | 'unavailable'
  task: ClaimTaskSnapshot | null
}

/** `POST /api/v1/tasks/:id/claim-fixall`: Astrid's own allowlisted boards and harnesses. */
export type FixallClaimAction = 'ready' | 'resume' | 'pause'

export interface FixallClaimRequest {
  action: FixallClaimAction
  /** The harness mailbox; the server defaults to copilot when absent. */
  agent?: string
  listId?: string
  /** Required by resume and pause; must be null for a ready claim. */
  commentWatermark?: string | null
  /** Resume context, passed through as the server validates it. */
  resume?: unknown
}

export interface FixallClaimResult {
  status: number
  claimed: boolean
  /** The server's reason on a refusal: a lost race and a missing agent account are both 409. */
  error?: string
  assigneeEmail?: string
}

export interface AstridTask {
  id: string
  identifier?: string | null
  title: string
  description?: string | null
  statusRole?: string | null
  completed?: boolean
  assigneeId?: string | null
  assigneeIds?: string[]
  listIds?: string[]
  updatedAt?: string
  [key: string]: unknown
}

export interface AstridComment {
  id: string
  content: string
  createdAt?: string
  authorId?: string | null
  [key: string]: unknown
}

/** Signs a write as an agent (AWTD-1620) instead of the OAuth client's owner. */
export interface SignedWrite {
  aiAgentId?: string
}
