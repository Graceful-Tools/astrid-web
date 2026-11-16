#!/usr/bin/env npx tsx
/**
 * Renew the claim leases this cloud run holds (ADEV-37).
 *
 *   npx tsx scripts/heartbeat-held-claims.ts --agent <mailbox> --list <boardId>
 *
 * agent-run.yml runs it every 5 minutes while the agent works, with
 * ASTRID_RUN_STARTED_AT set to the run's start. It renews only leases taken or
 * renewed since then (scripts/lib/held-claims.ts). It never fails the run:
 * every error is printed and the next tick tries again.
 */
import { loadScriptEnv } from './lib/load-env'
import { resolveAgentAuthorId } from './lib/agent-author'
import { boardTasksUrl } from './lib/board-read-url'
import { ASTRID_API, fetchScriptToken } from './lib/fixall-claim-request'
import { claimsToRenew, type HeldClaimTask } from './lib/held-claims'

loadScriptEnv()

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const mailbox = flag('--agent')
  const listId = flag('--list')
  const startedRaw = process.env.ASTRID_RUN_STARTED_AT
  const runStartedAt = startedRaw ? new Date(startedRaw) : null
  if (!mailbox || !listId || !runStartedAt || Number.isNaN(runStartedAt.getTime())) {
    console.error('HEARTBEAT: needs --agent, --list and ASTRID_RUN_STARTED_AT')
    return
  }
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('HEARTBEAT: no OAuth client in the environment')
    return
  }
  const token = await fetchScriptToken({ clientId, clientSecret })
  const agentId = await resolveAgentAuthorId({ mailbox, accessToken: token })
  if (!agentId) {
    console.error(`HEARTBEAT: could not resolve the ${mailbox} agent`)
    return
  }
  const auth = { 'X-OAuth-Token': token }
  const board = await fetch(boardTasksUrl({ boardId: listId, limit: 500, origin: ASTRID_API }), { headers: auth })
  if (!board.ok) {
    console.error(`HEARTBEAT: could not read the board — HTTP ${board.status}`)
    return
  }
  const tasks: HeldClaimTask[] = (await board.json()).tasks ?? []
  for (const id of claimsToRenew(tasks, { agentId, runStartedAt, now: new Date() })) {
    const response = await fetch(`${ASTRID_API}/api/v1/tasks/${id}/claim`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'heartbeat', agentMailbox: mailbox }),
    })
    console.log(`HEARTBEAT: ${id} → HTTP ${response.status}`)
  }
}

main().catch(error => console.error(`HEARTBEAT: ${(error as Error).message}`))
