import { AGENT_MAILBOXES, agentEmail } from "@/lib/brand/agent-emails"
import { READY_STATUS_ROLE, WAITING_STATUS_ROLE } from "@/lib/task-status"

export const FIXALL_CLAIM_AGENT_EMAIL = agentEmail(AGENT_MAILBOXES.copilot)
/**
 * The only boards an atomic /fixall claim may target — a SECURITY allowlist,
 * not a convenience list. Anything not here cannot be claimed by an agent.
 *
 * Configurable via FIXALL_CLAIM_BOARD_IDS (comma-separated) so a fork points at
 * its own boards rather than inheriting production ids it does not have
 * (task bc27c00a). The fallback is deliberately the current pair rather than
 * empty: this is the allowlist the running loop depends on, and failing closed
 * on an env var that has to be present at DEPLOY time — the exact trap
 * ASTRID.md warns about — would silently stop every agent claiming work.
 */
function resolveBoardIds(): readonly string[] {
  const configured = process.env.FIXALL_CLAIM_BOARD_IDS?.trim()
  if (configured) {
    return configured.split(",").map((id) => id.trim()).filter(Boolean)
  }
  return DEFAULT_FIXALL_CLAIM_BOARD_IDS
}

/** Astrid's own web and iOS to-do boards. */
const DEFAULT_FIXALL_CLAIM_BOARD_IDS = [
  "a623f322-4c3c-49b5-8a94-d2d9f00c82ba",
  "aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36",
] as const

export const FIXALL_CLAIM_BOARD_IDS: readonly string[] = resolveBoardIds()
export const FIXALL_CLAIM_ACTIONS = ["ready", "recheck", "review"] as const

export type FixallClaimAction = typeof FIXALL_CLAIM_ACTIONS[number]

export interface FixallClaimRequest {
  action: FixallClaimAction
  commentWatermark: string | null
}

export function parseFixallClaimRequest(body: unknown): FixallClaimRequest {
  if (!body || typeof body !== "object") throw new Error("Claim body must be an object")
  const candidate = body as Record<string, unknown>
  if (
    typeof candidate.action !== "string" ||
    !FIXALL_CLAIM_ACTIONS.includes(candidate.action as FixallClaimAction)
  ) {
    throw new Error("Claim action must be ready, recheck, or review")
  }

  const action = candidate.action as FixallClaimAction
  const commentWatermark = candidate.commentWatermark
  if (action === "ready") {
    if (commentWatermark !== undefined && commentWatermark !== null) {
      throw new Error("Ready claims must not include a comment watermark")
    }
    return { action, commentWatermark: null }
  }

  if (
    commentWatermark !== null &&
    (typeof commentWatermark !== "string" || Number.isNaN(Date.parse(commentWatermark)))
  ) {
    throw new Error("Waiting claims require a null or ISO comment watermark")
  }

  return { action, commentWatermark: commentWatermark as string | null }
}

export function buildAtomicFixallClaimWhere(input: {
  taskId: string
  agentId: string
  claim: FixallClaimRequest
  now: Date
}) {
  const { taskId, agentId, claim, now } = input
  const where = {
    id: taskId,
    completed: false,
    lists: { some: { id: { in: [...FIXALL_CLAIM_BOARD_IDS] } } },
    OR: [{ assigneeId: null }, { assigneeId: agentId }],
    statusRole: claim.action === "ready" ? READY_STATUS_ROLE : WAITING_STATUS_ROLE,
    ...(claim.action === "ready"
      ? {}
      : {
          comments: claim.commentWatermark
            ? { none: { updatedAt: { gt: new Date(claim.commentWatermark) } } }
            : { none: {} },
        }),
  }

  if (claim.action !== "review") {
    return {
      ...where,
      // isDueToStart treats a missing date as due now for Ready and RECHECK.
      AND: [{ OR: [{ dueDateTime: null }, { dueDateTime: { lte: now } }] }],
    }
  }

  return { ...where, dueDateTime: null }
}
