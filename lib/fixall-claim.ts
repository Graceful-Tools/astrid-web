import { READY_STATUS_ROLE, WAITING_STATUS_ROLE } from "@/lib/task-status"

export const FIXALL_CLAIM_AGENT_EMAIL = "copilot@astrid.cc"
export const FIXALL_CLAIM_BOARD_ID = "a623f322-4c3c-49b5-8a94-d2d9f00c82ba"
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
    lists: { some: { id: FIXALL_CLAIM_BOARD_ID } },
    OR: [{ assigneeId: null }, { assigneeId: agentId }],
    statusRole: claim.action === "ready" ? READY_STATUS_ROLE : WAITING_STATUS_ROLE,
    dueDateTime: claim.action === "review"
      ? null
      : { lte: now },
    ...(claim.action === "ready"
      ? {}
      : {
          comments: claim.commentWatermark
            ? { none: { updatedAt: { gt: new Date(claim.commentWatermark) } } }
            : { none: {} },
        }),
  }

  if (claim.action === "ready") {
    delete (where as { dueDateTime?: unknown }).dueDateTime
    return {
      ...where,
      AND: [{ OR: [{ dueDateTime: null }, { dueDateTime: { lte: now } }] }],
    }
  }

  return where
}
