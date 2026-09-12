#!/usr/bin/env tsx

import { loadScriptEnv } from './lib/load-env'
import { parseClaimArgs } from './lib/fixall-claim-args'

loadScriptEnv()

/**
 * Argv parsing lives in scripts/lib/fixall-claim-args.ts so it can be tested.
 * It used to be a `filter(arg => !arg.startsWith("--"))` here, which dropped
 * `--agent` but kept its value as the comment watermark — see AWTD-922.
 */
let args
try {
  args = parseClaimArgs(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const { taskId, action, commentWatermark, agent } = args

const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error("ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET are required")
  process.exit(1)
}

async function main() {
  const tokenResponse = await fetch("https://astrid.cc/api/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!tokenResponse.ok) {
    throw new Error(`OAuth token request failed with HTTP ${tokenResponse.status}`)
  }
  const { access_token: token } = await tokenResponse.json()

  const response = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}/claim-fixall`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OAuth-Token": token,
    },
    body: JSON.stringify({
      action,
      commentWatermark,
      ...(agent ? { agent } : {}),
    }),
  })

  if (response.status === 409) {
    // Exit 2, not 1: another session claimed it first. That is an ordinary
    // outcome of two loops sharing a board, and the caller should move to the
    // next task rather than treat it as a failure.
    //
    // Include the server's reason. The route returns 409 for TWO different
    // things — a lost race, and "no active agent account for <mailbox>" — and
    // printing one fixed sentence for both sent a /fixall run looking for a
    // peer session that did not exist (AWTD-922).
    const reason = await response.text().catch(() => "")
    console.error(
      `CLAIM_CONFLICT ${taskId}: claimed by someone else, or no longer eligible${
        reason ? ` — server said: ${reason}` : ""
      }`,
    )
    process.exit(2)
  }
  if (!response.ok) {
    throw new Error(`Claim failed with HTTP ${response.status}: ${await response.text()}`)
  }

  console.log(`CLAIMED ${taskId}`)
}

main().catch(error => {
  console.error(`Claim failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
