#!/usr/bin/env tsx

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

const positional = process.argv.slice(2).filter(arg => !arg.startsWith("--"))
const [taskId, action, commentWatermark = ""] = positional

/**
 * Which harness is claiming. Omitted means Copilot, because
 * .github/workflows/fixall.yml calls this with positional arguments only and is
 * deployed on its own schedule — the default has to keep meaning what it meant.
 * A local Claude Code or Codex loop passes its own mailbox so the task is
 * assigned to the harness that is actually going to do the work.
 */
const agentIndex = process.argv.indexOf("--agent")
const agent = agentIndex === -1 ? undefined : process.argv[agentIndex + 1]

if (!taskId || !action) {
  console.error(
    "Usage: claim-fixall-task.ts <task-id> <ready|recheck|review> [comment-watermark] [--agent <mailbox>]",
  )
  process.exit(1)
}

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
      commentWatermark: commentWatermark || null,
      ...(agent ? { agent } : {}),
    }),
  })

  if (response.status === 409) {
    // Exit 2, not 1: another session claimed it first. That is an ordinary
    // outcome of two loops sharing a board, and the caller should move to the
    // next task rather than treat it as a failure.
    console.error(`CLAIM_CONFLICT ${taskId}: claimed by someone else, or no longer eligible`)
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
