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
import { scriptClient } from './lib/script-client'
import { claimsToRenew, nothingToRenewLine, type HeldClaimTask } from './lib/held-claims'

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
  const client = scriptClient({ clientId, clientSecret })
  const agentId = await resolveAgentAuthorId({ mailbox, accessToken: await client.accessToken() })
  if (!agentId) {
    console.error(`HEARTBEAT: could not resolve the ${mailbox} agent`)
    return
  }
  // A failed board read throws (`HTTP <n> from /api/v1/tasks`) and main() prints it.
  const { tasks } = await client.getBoardTasks({ listId, limit: 500 })
  const board = tasks as HeldClaimTask[]
  const ids = claimsToRenew(board, { agentId, runStartedAt, now: new Date() })
  // One line when there is nothing to do, so a silent no-op shows in the log (ADEV-310).
  if (ids.length === 0) console.log(nothingToRenewLine(board, agentId))
  for (const id of ids) {
    const result = await client.heartbeatTask(id, { agentMailbox: mailbox })
    console.log(`HEARTBEAT: ${id} → HTTP ${result.status}`)
  }
}

main().catch(error => console.error(`HEARTBEAT: ${(error as Error).message}`))
