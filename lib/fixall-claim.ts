import { AGENT_MAILBOXES, agentEmail } from "@/lib/brand/agent-emails"
import { harnessAgentMailboxes } from "@/lib/ai/harness-agents"
import { DOING_STATUS_ROLE, READY_STATUS_ROLE, WAITING_STATUS_ROLE } from "@/lib/task-status"
import { parseAgentResumeContext, type AgentResumeContext } from '@/lib/agent-handback'
import { parseBlockedConditions } from '@/lib/ready-queue-scope'

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
export const FIXALL_CLAIM_MAILBOXES: readonly string[] = [
  AGENT_MAILBOXES.copilot,
  AGENT_MAILBOXES.claude,
  // Every local harness polls the queue and claims from it (AWTD-937).
  ...harnessAgentMailboxes(),
]

export type FixallClaimMailbox = string

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
 * (task bc27c00a). The fallback is deliberately the current boards rather than
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

/**
 * Astrid's own web, iOS, Windows and Android to-do boards. A board missing here does not
 * fail loudly: its claims 409 exactly like a lost race, and the loop skips them
 * without comment (AWTD-1008).
 */
const DEFAULT_FIXALL_CLAIM_BOARD_IDS = [
  "a623f322-4c3c-49b5-8a94-d2d9f00c82ba",
  "aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36",
  "abb4f961-55ee-499e-9c51-d4a2e31ee439",
  // Astrid Android To-do (AATD-22).
  "85eef4ce-3d4d-4072-9ca7-bd631ca815b1",
] as const

export const FIXALL_CLAIM_BOARD_IDS: readonly string[] = resolveBoardIds()
export const FIXALL_CLAIM_ACTIONS = ["ready", "recheck", "review", "resume", "pause"] as const

export type FixallClaimAction = typeof FIXALL_CLAIM_ACTIONS[number]

export interface NativeCopilotDispatch {
  repository: string
  issueNumber: number
}

export function nativeCopilotClaimMarker(listId: string, taskId: string, dispatch: NativeCopilotDispatch): string {
  return `NATIVE-COPILOT-CLAIM: ${JSON.stringify({ listId, taskId, ...dispatch })}`
}

export interface FixallClaimRequest {
  /** Optional for legacy callers; new launchers pin the exact selected board. */
  listId?: string
  taskVersion?: string
  nativeDispatch?: NativeCopilotDispatch
  resume?: AgentResumeContext
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
    throw new Error("Claim action must be ready, recheck, review, resume, or pause")
  }

  const action = candidate.action as FixallClaimAction
  const agent = parseClaimMailbox(candidate.agent)
  const listId = candidate.listId
  if (listId !== undefined && (typeof listId !== 'string' || !FIXALL_CLAIM_BOARD_IDS.includes(listId))) {
    throw new Error('Claim listId must be an allowed board')
  }
  const scope = typeof listId === 'string' ? { listId } : {}
  let nativeDispatch: NativeCopilotDispatch | undefined
  if (candidate.nativeDispatch !== undefined) {
    const dispatch = candidate.nativeDispatch as Partial<NativeCopilotDispatch> | null
    if (action !== 'ready' || agent !== 'copilot' || !listId || !dispatch ||
        typeof dispatch.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(dispatch.repository) ||
        typeof dispatch.issueNumber !== 'number' || !Number.isSafeInteger(dispatch.issueNumber) || dispatch.issueNumber < 1) {
      throw new Error('Native dispatch requires a Copilot Ready claim, explicit board, repository and positive issue number')
    }
    nativeDispatch = { repository: dispatch.repository, issueNumber: dispatch.issueNumber }
  }
  const commentWatermark = candidate.commentWatermark
  if (action === 'pause') {
    if (!listId || typeof candidate.taskVersion !== 'string' || !Number.isFinite(Date.parse(candidate.taskVersion))) {
      throw new Error('Pause requires an explicit board and ISO taskVersion')
    }
    if (typeof commentWatermark !== 'string' || !Number.isFinite(Date.parse(commentWatermark))) {
      throw new Error('Pause requires an ISO comment watermark')
    }
    return { action, agent, commentWatermark, taskVersion: candidate.taskVersion, ...scope }
  }
  if (action === 'resume') {
    const resume = parseAgentResumeContext(candidate.resume)
    if (commentWatermark !== resume.commentWatermark) throw new Error('Resume watermark must match context')
    if (!FIXALL_CLAIM_BOARD_IDS.includes(resume.listId)) throw new Error('Resume board is not allowed')
    if (listId !== undefined && listId !== resume.listId) throw new Error('Claim board must match resume board')
    return { action, agent, commentWatermark: resume.commentWatermark, resume, ...scope }
  }
  if (action === "ready") {
    if (commentWatermark !== undefined && commentWatermark !== null) {
      throw new Error("Ready claims must not include a comment watermark")
    }
    return { action, commentWatermark: null, agent, ...scope, ...(nativeDispatch ? { nativeDispatch } : {}) }
  }

  if (
    commentWatermark !== null &&
    (typeof commentWatermark !== "string" || Number.isNaN(Date.parse(commentWatermark)))
  ) {
    throw new Error("Waiting claims require a null or ISO comment watermark")
  }

  return { action, commentWatermark: commentWatermark as string | null, agent, ...scope }
}

export function buildAtomicFixallClaimWhere(input: {
  taskId: string
  agentId: string
  claim: FixallClaimRequest
  now: Date
}) {
  const { taskId, agentId, claim, now } = input
  if (claim.action === 'pause') {
    if (!claim.taskVersion || !claim.commentWatermark || !claim.listId) throw new Error('Pause metadata is required')
    return {
      id: taskId, completed: false, assigneeId: agentId, statusRole: DOING_STATUS_ROLE,
      updatedAt: new Date(claim.taskVersion),
      lists: { some: { id: { in: [claim.listId] } } },
      comments: { none: { updatedAt: { gt: new Date(claim.commentWatermark) } } },
    }
  }
  const where = {
    id: taskId,
    completed: false,
    lists: { some: { id: { in: claim.listId ? [claim.listId] : [...FIXALL_CLAIM_BOARD_IDS] } } },
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
  if (claim.action === 'pause') return { assigneeId: agentId, statusRole: WAITING_STATUS_ROLE }
  if (claim.action !== "ready" && claim.action !== 'resume') return { assigneeId: agentId }
  return { assigneeId: agentId, statusRole: DOING_STATUS_ROLE }
}

/**
 * The commit a task is already waiting to see deployed, when its NEWEST comment
 * is the handoff that says so (`AWAITING-DEPLOY: <sha>`); otherwise null.
 *
 * A Ready claim on such a task is a second fix of finished work. AWTD-1432 was
 * fixed in #601 and handed off to Waiting, came back to Ready with no comment
 * saying why, and the next run fixed it again in #603. Whatever moves a card,
 * the claim is the one gate every harness passes, so the check lives here.
 *
 * Only the newest comment counts. Anyone who wants the work redone says so on
 * the task, and that comment is newer than the marker.
 */
export function pendingDeployHandoff(
  comments: Array<{ content?: string | null; createdAt?: string | Date | null }>,
): string | null {
  const newest = comments.reduce<(typeof comments)[number] | null>((latest, comment) =>
    !latest || new Date(comment.createdAt ?? 0) > new Date(latest.createdAt ?? 0) ? comment : latest, null)
  if (!newest) return null
  const createdAt = newest.createdAt instanceof Date ? newest.createdAt.toISOString() : newest.createdAt
  return parseBlockedConditions([{ content: newest.content, createdAt }]).awaitingDeploy
}

/** The note a refused claim leaves. It repeats the marker so it stays the newest one. */
export function handedOffParkComment(sha: string): string {
  return [
    'This task came back to Ready, but its fix is already handed off and waiting for its deploy, ' +
      'so the claim was refused and the task is back in Waiting. The runner completes it once ' +
      'production serves the commit. To have it redone, say so in a comment and move it to Ready.',
    '',
    `AWAITING-DEPLOY: ${sha}`,
  ].join('\n')
}
