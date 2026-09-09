import { AGENT_MAILBOXES, agentEmail } from "@/lib/brand/agent-emails"
import { DOING_STATUS_ROLE, READY_STATUS_ROLE, WAITING_STATUS_ROLE } from "@/lib/task-status"

/**
 * The Copilot cloud identity — the DEFAULT claimant, not the only one.
 *
 * Still exported under this name because app/api/coding-agent/github-trigger
 * gates on it: that endpoint dispatches the Copilot cloud workflow, so a task it
 * accepts must be assigned to Copilot specifically. A claim from another harness
 * is a different thing and must not open that door.
 */
export const FIXALL_CLAIM_AGENT_EMAIL = agentEmail(AGENT_MAILBOXES.copilot)

/**
 * Which harnesses may hold a /fixall claim — an ALLOWLIST, like the board ids
 * below, and for the same reason: a claim decides which account ends up owning
 * the task, so an arbitrary mailbox must never reach the user lookup.
 *
 * Exactly the three harnesses docs/FIXALL_WORKFLOW.md names as running the loop.
 * A server-side AI provider is not here: those are dispatched work, they do not
 * poll a queue and claim from it.
 */
export const FIXALL_CLAIM_MAILBOXES = [
  AGENT_MAILBOXES.copilot,
  AGENT_MAILBOXES.claude,
  AGENT_MAILBOXES.codex,
] as const

export type FixallClaimMailbox = typeof FIXALL_CLAIM_MAILBOXES[number]

/**
 * Copilot when unstated.
 *
 * .github/workflows/fixall.yml sends no `agent` and is deployed independently of
 * this API, so the absence of the field has to keep meaning exactly what it
 * meant before it existed.
 */
export const DEFAULT_FIXALL_CLAIM_MAILBOX: FixallClaimMailbox = AGENT_MAILBOXES.copilot

/** The identity a claim assigns, built from the brand rather than a literal. */
export function fixallClaimAgentEmail(mailbox: FixallClaimMailbox): string {
  return agentEmail(mailbox)
}
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
  /** The harness claiming the task. Copilot when the caller does not say. */
  agent: FixallClaimMailbox
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
  const agent = parseClaimMailbox(candidate.agent)
  const commentWatermark = candidate.commentWatermark
  if (action === "ready") {
    if (commentWatermark !== undefined && commentWatermark !== null) {
      throw new Error("Ready claims must not include a comment watermark")
    }
    return { action, commentWatermark: null, agent }
  }

  if (
    commentWatermark !== null &&
    (typeof commentWatermark !== "string" || Number.isNaN(Date.parse(commentWatermark)))
  ) {
    throw new Error("Waiting claims require a null or ISO comment watermark")
  }

  return { action, commentWatermark: commentWatermark as string | null, agent }
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

function parseClaimMailbox(value: unknown): FixallClaimMailbox {
  if (value === undefined || value === null) return DEFAULT_FIXALL_CLAIM_MAILBOX
  if (
    typeof value !== "string" ||
    !FIXALL_CLAIM_MAILBOXES.includes(value as FixallClaimMailbox)
  ) {
    throw new Error(
      `Claim agent must be a /fixall harness: ${FIXALL_CLAIM_MAILBOXES.join(", ")}`,
    )
  }
  return value as FixallClaimMailbox
}

/**
 * What the claiming UPDATE writes — and the reason a claim is EXCLUSIVE.
 *
 * The where clause above requires `statusRole: ready`; this moves the task to
 * `doing`. Because a claim is one `UPDATE ... WHERE`, two concurrent claims
 * cannot both match: whichever commits first flips the status out from under the
 * predicate, and the second matches zero rows and is reported as a conflict.
 *
 * Before this, the update wrote only `assigneeId` while the where accepted
 * `assigneeId: null OR assigneeId: agentId` — so a second worker running as the
 * same agent matched on the second arm and was ALSO told it had claimed the task.
 * That is how two Claude Code sessions came to work AWTD-865 at the same time on
 * 2026-09-09. It went unnoticed in CI because .github/workflows/fixall.yml has a
 * `concurrency:` group; a local loop has nothing equivalent.
 *
 * RECHECK and REVIEW deliberately do NOT move the task. Those re-examine a task
 * paused in Waiting, and promoting them to Doing would empty the Waiting lane on
 * every sweep and discard the condition the lane exists to record. They are also
 * therefore NOT mutually exclusive — they are cheap, idempotent re-reads, and the
 * comment watermark already guards the case that matters.
 *
 * NOTE for whoever merges AWTD-871 (a queue that does not require a Ready
 * column): tasks with `statusRole: null` are queueable there, and this where
 * clause would not match them. Widen it to `{ in: [READY_STATUS_ROLE, null] }`
 * at the same time, or those claims silently conflict on every attempt.
 */
export function buildFixallClaimData(input: {
  agentId: string
  claim: FixallClaimRequest
}): { assigneeId: string; statusRole?: string } {
  const { agentId, claim } = input
  if (claim.action !== "ready") return { assigneeId: agentId }
  return { assigneeId: agentId, statusRole: DOING_STATUS_ROLE }
}
