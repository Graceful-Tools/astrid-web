#!/usr/bin/env tsx

import { loadScriptEnv } from './lib/load-env'
import { parseClaimArgs } from './lib/fixall-claim-args'
import { fetchScriptToken, recordClaim, requestFixallClaim } from './lib/fixall-claim-request'

loadScriptEnv()

/**
 * Argv parsing lives in scripts/lib/fixall-claim-args.ts so it can be tested.
 * It used to be a `filter(arg => !arg.startsWith("--"))` here, which dropped
 * `--agent` but kept its value as the comment watermark — see AWTD-922.
 *
 * To take the first Ready task nobody else has rather than a named one, use
 * scripts/claim-next-fixall-task.ts (ADEV-26), which moves past a 409 by itself.
 */
let args
try {
  args = parseClaimArgs(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const { taskId, action, commentWatermark, agent, resume, listId } = args

const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error("ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET are required")
  process.exit(1)
}

async function main() {
  const token = await fetchScriptToken({ clientId: clientId!, clientSecret: clientSecret! })
  const attempt = await requestFixallClaim({ token, taskId, action, commentWatermark, agent, resume, listId })

  if (attempt.status === 'conflict') {
    // Exit 2, not 1: another session claimed it first. That is an ordinary
    // outcome of two loops sharing a board, and the caller should move to the
    // next task rather than treat it as a failure.
    //
    // Include the server's reason. The route returns 409 for TWO different
    // things — a lost race, and "no active agent account for <mailbox>" — and
    // printing one fixed sentence for both sent a /fixall run looking for a
    // peer session that did not exist (AWTD-922).
    console.error(
      `CLAIM_CONFLICT ${taskId}: claimed by someone else, or no longer eligible${
        attempt.reason ? ` — server said: ${attempt.reason}` : ""
      }`,
    )
    process.exit(2)
  }

  console.log(`CLAIMED ${taskId}`)
  recordClaim(taskId, action)
}

main().catch(error => {
  console.error(`Claim failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
