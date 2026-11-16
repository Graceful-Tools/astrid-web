/**
 * The HTTP half of a /fixall claim, shared by `scripts/claim-fixall-task.ts` (one named
 * task) and `scripts/claim-next-fixall-task.ts` (the first Ready task nobody else has,
 * ADEV-26). One copy, so the two cannot disagree about what a 409 means. The request itself is
 * the SDK client's (ADEV-9): this file adds only the claim-or-conflict value and the claims file.
 */

import { appendFileSync } from 'node:fs'

import type { AstridClient } from '../../packages/astrid-sdk/src/client'
import { ASTRID_API } from './script-client'

export { ASTRID_API }

export type ClaimAttempt = { status: 'claimed' } | { status: 'conflict'; reason: string }

/**
 * POST /api/v1/tasks/<id>/claim-fixall. A 409 is an ordinary outcome of loops sharing a
 * board, so it is a value, not an error. The route returns 409 for TWO things — a lost
 * race, and "no active agent account for <mailbox>" — so the server's reason is kept
 * (AWTD-922). Any other failure throws.
 */
export async function requestFixallClaim(input: {
  client: AstridClient
  taskId: string
  action: 'ready' | 'resume' | 'pause'
  commentWatermark?: string | null
  agent?: string
  resume?: unknown
  listId?: string
}): Promise<ClaimAttempt> {
  const result = await input.client.claimFixallTask(input.taskId, {
    action: input.action,
    commentWatermark: input.commentWatermark ?? null,
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.resume ? { resume: input.resume } : {}),
    ...(input.listId ? { listId: input.listId } : {}),
  })
  return result.claimed ? { status: 'claimed' } : { status: 'conflict', reason: result.error ?? '' }
}

/**
 * A scheduled runner passes a file to collect this run's claims. After the run it releases
 * any of them still in Doing — the run died or stopped mid-task — so they do not sit there
 * forever (scripts/release-stuck-doing.ts). Only a Ready or resume claim moves a task to Doing.
 */
export function recordClaim(taskId: string, action: string, claimsFile = process.env.ASTRID_FIXALL_CLAIMS_FILE): void {
  if (claimsFile && (action === 'ready' || action === 'resume')) appendFileSync(claimsFile, `${taskId}\n`)
}
