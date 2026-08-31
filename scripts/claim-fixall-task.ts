#!/usr/bin/env tsx

const [taskId, action, commentWatermark = ""] = process.argv.slice(2)
if (!taskId || !action) {
  console.error("Usage: claim-fixall-task.ts <task-id> <ready|recheck|review> [comment-watermark]")
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
    }),
  })

  if (response.status === 409) {
    console.error(`CLAIM_CONFLICT ${taskId}: task is no longer eligible`)
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
