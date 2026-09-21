#!/usr/bin/env npx tsx
/**
 * Is there anything for this agent to do right now? No session, no tokens.
 *
 * WHY THIS EXISTS. A scheduled /fixall tick used to answer that question by
 * starting a whole Claude session — loading CLAUDE.md, fixall.md and the MCP
 * tool schemas — just to call get_agent_queue once and find `empty: true`. At
 * two ticks an hour that is most of the day's tokens spent learning there was
 * no work. GET /api/v1/agent-queue is the same question for the price of one
 * request, so the loop asks it first and only pays for a session when the
 * answer is yes.
 *
 * WHAT "YES" MEANS. Three things, because the run is required to act on all
 * three and until 2026-09-20 this script saw only the first:
 *
 *   1. `queue`     — Ready, assigned to this agent, due. The endpoint's `empty`.
 *   2. `attention` — comments and list-chat replies nobody has answered
 *                    (AWTD-963). Same call, and the loop skipped past two direct
 *                    questions from Jon because it read only `empty`.
 *   3. the lanes   — `--board <web|ios|windows>` runs the sweep
 *                    (scripts/ready-tasks.ts) as this agent's harness: dated
 *                    Ready work parks in Waiting, met conditions promote back to
 *                    Ready, and RECHECK/REVIEW items come out as work. Without
 *                    this a parked task could never wake the loop by itself —
 *                    the sweep ran only inside a session, and a session needed a
 *                    non-empty queue to start.
 *
 * WAKING IS BOUNDED. A seen-file (default: ~/Library/Caches/astrid-fixall/
 * seen-<agent>-<list>.json on macOS, $XDG_CACHE_HOME or ~/.cache elsewhere;
 * override with `--seen <file>`) records which inbox and lane items have
 * already woken a run; the same item never wakes a second one, a new comment
 * does. Without it an item the agent chose not to answer would start a
 * session every half hour, forever — the bill this guard exists to avoid.
 * The decision lives in scripts/lib/agent-queue-verdict.ts, where it is
 * tested; the path math lives in scripts/lib/fixall-seen-file.ts, tested
 * too. The file is machine-local state, NOT repo state: the old default
 * under node_modules/.cache was wiped by every `npm ci`, and the next tick
 * woke every unanswered item at once.
 *
 * Usage:
 *   npx tsx scripts/agent-queue-status.ts --agent claude --list <listId> --board web
 *   npx tsx scripts/agent-queue-status.ts --agent claude --list <listId>            # no sweep; lanes reported as not read
 *   npx tsx scripts/agent-queue-status.ts --agent claude --list <listId> --json
 *
 * Exit codes are the interface, matching the fixall scripts around it:
 *   0  there is work — the caller should start a run
 *   3  nothing to do — the caller should skip, and why is on stdout
 *   1  could not tell (network, auth). A caller must NOT treat this as empty.
 *
 * Every verdict is one `QUEUE:` line. Lane moves the sweep made are `LANES:`
 * lines, so a log of skips still shows the board being kept honest.
 *
 * `--json` prints the raw endpoint response for debugging a queue that is empty
 * when you did not expect it to be; the `hint` field says which condition was
 * the unmet one.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { loadScriptEnv } from './lib/load-env'
import { FIXALL_HARNESS_MAILBOXES } from '@/lib/ready-queue-scope'
import { parseReadyTaskClaims } from './lib/ready-tasks-output'
import { adoptLegacySeenFile, defaultSeenFile } from './lib/fixall-seen-file'
import { decideQueueVerdict, type LaneSnapshot, type QueueSnapshot } from './lib/agent-queue-verdict'

loadScriptEnv()

const API = 'https://astrid.cc'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

/**
 * The sweep takes a harness selector (`claude-code`), this script takes a
 * mailbox (`claude`). The map only runs one way, so invert it. No match means
 * no sweep — named on stdout, never silently.
 */
function harnessForMailbox(mailbox: string): string | undefined {
  return Object.entries(FIXALL_HARNESS_MAILBOXES).find(([, box]) => box === mailbox)?.[0]
}

/**
 * Run the lane sweep and return its RECHECK/REVIEW items.
 *
 * Null means "could not read" — a failed sweep is reported, not treated as a
 * clean board, and not treated as a reason to run either: the session could
 * not read the lanes any better than this could, and a sweep that is broken
 * every tick must not become a session every tick.
 */
function readLanes(board: string, mailbox: string): { lanes: LaneSnapshot; notes: string[] } {
  const harness = harnessForMailbox(mailbox)
  if (!harness) {
    return { lanes: null, notes: [`LANES: not swept — no harness selector maps to mailbox "${mailbox}"`] }
  }

  const result = spawnSync(
    'npx',
    ['tsx', 'scripts/ready-tasks.ts', board, '--json', '--harness', harness],
    { encoding: 'utf8', env: process.env },
  )

  // The sweep reports its moves on stderr in JSON mode ("→ parked …").
  const notes = (result.stderr ?? '')
    .split('\n')
    .filter(line => line.startsWith('→'))
    .map(line => `LANES: ${line.slice(1).trim()}`)

  if (result.status !== 0) {
    const why = (result.stderr ?? '').trim().split('\n').pop() ?? `exit ${result.status}`
    return { lanes: null, notes: [...notes, `LANES: not read — ${why}`] }
  }

  // The envelope is one JSON line. Take that line rather than the whole
  // stream, so a stray stdout line from a dependency (dotenv's banner was one)
  // cannot turn the lanes into "not read" every tick.
  const envelope = (result.stdout ?? '').split('\n').find(line => line.startsWith('{')) ?? ''

  try {
    const lanes = parseReadyTaskClaims(envelope).filter(
      (claim): claim is { id: string; action: 'recheck' | 'review'; commentWatermark: string | null } =>
        claim.action !== 'ready',
    )
    return { lanes, notes }
  } catch (error) {
    return {
      lanes: null,
      notes: [...notes, `LANES: not read — ${error instanceof Error ? error.message : error}`],
    }
  }
}

function readSeen(file: string | undefined): Set<string> {
  if (!file || !existsSync(file)) return new Set()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return new Set(Array.isArray(parsed) ? parsed.filter(k => typeof k === 'string') : [])
  } catch {
    // An unreadable file is an empty memory: the worst case is one extra
    // run, which beats a guard that cannot start.
    return new Set()
  }
}

function writeSeen(file: string | undefined, keys: string[]): void {
  if (!file) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`)
  } catch (error) {
    console.log(`SEEN: could not write ${file} — ${error instanceof Error ? error.message : error}`)
  }
}

async function main() {
  const agent = arg('--agent') || 'claude'
  const listId = arg('--list')
  const board = arg('--board')
  const asJson = process.argv.includes('--json')

  if (!listId) {
    console.error(
      'Usage: npx tsx scripts/agent-queue-status.ts --agent <mailbox> --list <listId> [--board web|ios|windows] [--seen <file>]',
    )
    process.exit(1)
  }

  // Bounded by DEFAULT, not by flag: the iOS loop calls this script from the
  // web checkout with no flags, and an inbox item it never answers must not
  // start an iOS session every half hour either. Per agent and list, in the
  // OS cache dir — machine-local state that survives `npm ci`
  // (scripts/lib/fixall-seen-file.ts).
  const seenFile = arg('--seen') ?? defaultSeenFile(agent, listId)
  if (!arg('--seen')) {
    // One-time move of the pre-2026-09-21 default, so a deploy does not
    // re-wake every item the old file had already muted.
    const adopted = adoptLegacySeenFile(agent, listId, seenFile)
    if (adopted) console.log(`SEEN: adopted legacy seen-file at ${adopted}`)
  }

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('QUEUE: unknown — ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET are required')
    process.exit(1)
  }

  // The sweep goes FIRST: a Waiting task it promotes is Ready by the time the
  // endpoint is asked, so the queue half of the verdict sees it this tick and
  // not the next.
  const { lanes, notes } = board ? readLanes(board, agent) : { lanes: null, notes: [] }
  for (const note of notes) console.log(note)

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

  const snapshot = (await response.json()) as QueueSnapshot

  if (asJson) {
    console.log(JSON.stringify(snapshot, null, 2))
  }

  // A board that was not swept has lanes nobody looked at — say so rather than
  // let "not asked" read as "clear".
  const verdict = decideQueueVerdict({ snapshot, lanes: board ? lanes : null, seen: readSeen(seenFile) })

  if (!asJson) console.log(verdict.line)

  // Every wake-able item present now has had its chance after this tick,
  // whether the run starts or not.
  writeSeen(seenFile, verdict.keys)

  process.exit(verdict.work ? 0 : 3)
}

main().catch(error => {
  console.error(`QUEUE: unknown — ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
