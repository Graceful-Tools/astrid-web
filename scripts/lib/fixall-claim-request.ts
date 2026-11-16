/**
 * The HTTP half of a /fixall claim, shared by `scripts/claim-fixall-task.ts` (one named
 * task) and `scripts/claim-next-fixall-task.ts` (the first Ready task nobody else has,
 * ADEV-26). One copy, so the two cannot disagree about what a 409 means.
 */

import { appendFileSync } from 'node:fs'

export const ASTRID_API = 'https://astrid.cc'

type Fetch = typeof fetch

/** A client-credentials token for the script OAuth client in the environment. */
export async function fetchScriptToken(input: {
  clientId: string
  clientSecret: string
  fetchImpl?: Fetch
  origin?: string
}): Promise<string> {
  const response = await (input.fetchImpl ?? fetch)(`${input.origin ?? ASTRID_API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: input.clientId, client_secret: input.clientSecret }),
  })
  if (!response.ok) throw new Error(`OAuth token request failed with HTTP ${response.status}`)
  const { access_token: token } = await response.json()
  return token
}

export type ClaimAttempt = { status: 'claimed' } | { status: 'conflict'; reason: string }

/**
 * POST /api/v1/tasks/<id>/claim-fixall. A 409 is an ordinary outcome of loops sharing a
 * board, so it is a value, not an error. The route returns 409 for TWO things — a lost
 * race, and "no active agent account for <mailbox>" — so the server's reason is kept
 * (AWTD-922). Any other failure throws.
 */
export async function requestFixallClaim(input: {
  token: string
  taskId: string
  action: string
  commentWatermark?: string | null
  agent?: string
  resume?: unknown
  listId?: string
  fetchImpl?: Fetch
  origin?: string
}): Promise<ClaimAttempt> {
  const { agent } = input
  const response = await (input.fetchImpl ?? fetch)(
    `${input.origin ?? ASTRID_API}/api/v1/tasks/${input.taskId}/claim-fixall`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OAuth-Token': input.token },
      body: JSON.stringify({
        action: input.action,
        commentWatermark: input.commentWatermark ?? null,
        ...(agent ? { agent } : {}),
        ...(input.resume ? { resume: input.resume } : {}),
        ...(input.listId ? { listId: input.listId } : {}),
      }),
    },
  )
  if (response.status === 409) {
    return { status: 'conflict', reason: await response.text().catch(() => '') }
  }
  if (!response.ok) throw new Error(`Claim failed with HTTP ${response.status}: ${await response.text()}`)
  return { status: 'claimed' }
}

/**
 * A scheduled runner passes a file to collect this run's claims. After the run it releases
 * any of them still in Doing — the run died or stopped mid-task — so they do not sit there
 * forever (scripts/release-stuck-doing.ts). Only a Ready or resume claim moves a task to Doing.
 */
export function recordClaim(taskId: string, action: string, claimsFile = process.env.ASTRID_FIXALL_CLAIMS_FILE): void {
  if (claimsFile && (action === 'ready' || action === 'resume')) appendFileSync(claimsFile, `${taskId}\n`)
}
