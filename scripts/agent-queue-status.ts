#!/usr/bin/env npx tsx
/**
 * Is there anything for this agent to do right now? One HTTP request, no session.
 *
 * WHY THIS EXISTS. A scheduled /fixall tick used to answer that question by
 * starting a whole Claude session — loading CLAUDE.md, fixall.md and the MCP
 * tool schemas — just to call get_agent_queue once and find `empty: true`. At
 * two ticks an hour that is most of the day's tokens spent learning there was
 * no work. GET /api/v1/agent-queue is the same question for the price of one
 * request, so the loop asks it first and only pays for a session when the
 * answer is yes.
 *
 * Usage:
 *   npx tsx scripts/agent-queue-status.ts --agent claude --list <listId>
 *   npx tsx scripts/agent-queue-status.ts --agent claude --list <listId> --json
 *
 * Exit codes are the interface, matching the fixall scripts around it:
 *   0  there is work — the caller should start a run
 *   3  the queue is empty — the caller should skip, and why is on stdout
 *   1  could not tell (network, auth). A caller must NOT treat this as empty.
 *
 * `--json` prints the raw endpoint response for debugging a queue that is empty
 * when you did not expect it to be; the `hint` field says which condition was
 * the unmet one.
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

const API = 'https://astrid.cc'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const agent = arg('--agent') || 'claude'
  const listId = arg('--list')
  const asJson = process.argv.includes('--json')

  if (!listId) {
    console.error('Usage: npx tsx scripts/agent-queue-status.ts --agent <mailbox> --list <listId>')
    process.exit(1)
  }

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('QUEUE: unknown — ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET are required')
    process.exit(1)
  }

  const tokenResponse = await fetch(`${API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  if (!tokenResponse.ok) {
    console.error(`QUEUE: unknown — OAuth token request failed with HTTP ${tokenResponse.status}`)
    process.exit(1)
  }
  const { access_token: token } = await tokenResponse.json()

  const url = `${API}/api/v1/agent-queue?agent=${encodeURIComponent(agent)}&listId=${encodeURIComponent(listId)}`
  const response = await fetch(url, { headers: { 'X-OAuth-Token': token } })
  if (!response.ok) {
    console.error(`QUEUE: unknown — HTTP ${response.status} from /api/v1/agent-queue`)
    process.exit(1)
  }

  const result = await response.json()

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
  }

  if (!result.empty) {
    const n = result.queue?.length ?? 0
    if (!asJson) console.log(`QUEUE: ${n} task${n === 1 ? '' : 's'} ready`)
    process.exit(0)
  }

  // A queue held up by the clock is not an idle one — say when it opens, so a
  // log of skips still tells you the loop is waiting rather than broken.
  const next = result.held?.scheduled?.[0]
  if (!asJson) {
    console.log(
      next
        ? `QUEUE: empty — next task ("${next.title}") comes due ${next.startsAt}`
        : `QUEUE: empty${result.hint ? ` — ${result.hint}` : ''}`
    )
  }
  process.exit(3)
}

main().catch(error => {
  console.error(`QUEUE: unknown — ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
