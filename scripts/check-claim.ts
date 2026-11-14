#!/usr/bin/env tsx
/**
 * Re-check a /fixall claim before merging (AWTD-1658).
 *
 *   npx tsx scripts/check-claim.ts <taskId> --agent <claude|copilot|codex>
 *
 * Exit 0: the task is still in Doing (or Testing), incomplete, and assigned to this agent, so
 *         merge. Exit 2: the claim was lost; the reason is printed. Do NOT merge: leave the
 *         branch pushed and say on the task what you found. Exit 1: the check itself failed.
 *         That is not permission either.
 *
 * The rule is scripts/lib/claim-still-held.ts; docs/FIXALL_WORKFLOW.md → *Per task* says when.
 */

import { loadScriptEnv } from './lib/load-env'
import { agentMailboxFrom, positionalArgs } from './lib/agent-author'
import { agentEmail } from '@/lib/brand/agent-emails'
import { claimVerdict } from './lib/claim-still-held'

loadScriptEnv()

async function main() {
  const [taskId] = positionalArgs()
  const mailbox = agentMailboxFrom()
  if (!taskId || !mailbox) {
    console.error('Usage: npx tsx scripts/check-claim.ts <taskId> --agent <mailbox>')
    process.exit(1)
  }

  const tokenResponse = await fetch('https://astrid.cc/api/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.ASTRID_OAUTH_CLIENT_ID,
      client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET,
    }),
  })
  if (!tokenResponse.ok) throw new Error(`OAuth token request failed with HTTP ${tokenResponse.status}`)
  const { access_token: token } = await tokenResponse.json()

  // GET /api/v1/tasks/:id answers { task, meta } (docs/FIXALL_WEB.md → Environment gotchas).
  const response = await fetch(`https://astrid.cc/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { 'X-OAuth-Token': token },
  })
  if (!response.ok) throw new Error(`Task read failed with HTTP ${response.status}`)
  const { task } = await response.json()

  const verdict = claimVerdict(task, agentEmail(mailbox))
  if (verdict.held) {
    console.log(`CLAIM_HELD ${taskId}`)
    return
  }
  console.error(`CLAIM_LOST ${taskId}: ${verdict.reason}. Do not merge; leave the branch pushed and say so on the task.`)
  process.exit(2)
}

main().catch((error) => {
  console.error(`Claim check failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
