/**
 * `astrid-agent`: the runner command a scheduler or a GitHub Actions job calls.
 * Its exit codes are the interface:
 *
 *   queue    0 there is work, start a run
 *            3 nothing to do, skip this tick
 *            1 could not tell (network, auth); never treat this as idle
 *   claim    0 claimed, start the task
 *   heartbeat 0 lease renewed, keep working
 *   release  0 released
 *            2 someone else has it, or it is no longer eligible; move on
 *            1 error
 *
 * These match astrid-web's scripts/agent-queue-status.ts and
 * scripts/claim-fixall-task.ts, which this command is meant to replace.
 *
 * Credentials come from the environment and are never printed:
 *   ASTRID_TOKEN                               an agent-bound token (preferred)
 *   ASTRID_CLIENT_ID + ASTRID_CLIENT_SECRET    client credentials
 *     (ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET are accepted too)
 *   ASTRID_API_URL                             the server origin
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { AstridApiError, AstridClient, type AstridAuth } from './client.js'
import { decideQueueVerdict } from './verdict.js'

export const EXIT = {
  /** Work to do / the write succeeded. */
  WORK: 0,
  ERROR: 1,
  /** Claim or release refused: another worker has it, or it is not eligible. */
  CONFLICT: 2,
  /** The queue is idle. */
  IDLE: 3,
} as const

export interface CliIO {
  env: Record<string, string | undefined>
  fetch?: typeof fetch
  stdout: (line: string) => void
  stderr: (line: string) => void
}

export const USAGE = `Usage: astrid-agent <command> [options]

Commands:
  queue    --agent <mailbox> [--list <listId>] [--include-unassigned]
           [--seen <file> [--write-seen]]
           Print the queue verdict as JSON. Exit 0 work, 3 idle, 1 could not tell.
  claim    <taskId> [--agent <mailbox>] [--resume] [--lease-seconds <n>]
           Atomic claim (POST /api/v1/tasks/:id/claim). Exit 0 claimed, 2 taken, 1 error.
           The claim holds a lease (15 min by default): heartbeat while you work.
  heartbeat <taskId> [--agent <mailbox>] [--lease-seconds <n>]
           Renew the claim lease. Exit 0 renewed, 2 the claim is gone (stop), 1 error.
  claim    <taskId> --fixall [--agent <mailbox>] [--list <listId>]
           Claim through /claim-fixall (Astrid's allowlisted boards).
  release  <taskId> [--agent <mailbox>] [--comment <text>]
           Give a Doing claim back to Ready. Exit 0 released, 2 not yours, 1 error.

Options:
  --origin <url>   Server origin (default: ASTRID_API_URL, then production)
  -h, --help       Show this help
  -v, --version    Show the version

Environment:
  ASTRID_TOKEN, or ASTRID_CLIENT_ID and ASTRID_CLIENT_SECRET`

const VALUED = new Set(['--agent', '--list', '--seen', '--origin', '--comment', '--lease-seconds'])
const BOOLEAN = new Set(['--include-unassigned', '--write-seen', '--resume', '--fixall', '--help', '-h', '--version', '-v'])

interface Parsed {
  positional: string[]
  flags: Map<string, string>
  switches: Set<string>
}

/** One left-to-right pass, so a flag's value is never read as a positional (AWTD-922). */
function parse(argv: string[]): Parsed {
  const positional: string[] = []
  const flags = new Map<string, string>()
  const switches = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (VALUED.has(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} requires a value`)
      flags.set(arg, value)
      i++
    } else if (BOOLEAN.has(arg)) {
      switches.add(arg)
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option ${arg}`)
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags, switches }
}

class UsageError extends Error {}

function authFrom(env: CliIO['env']): AstridAuth {
  const token = env.ASTRID_TOKEN?.trim()
  if (token) return { token }
  const clientId = (env.ASTRID_CLIENT_ID || env.ASTRID_OAUTH_CLIENT_ID)?.trim()
  const clientSecret = (env.ASTRID_CLIENT_SECRET || env.ASTRID_OAUTH_CLIENT_SECRET)?.trim()
  if (clientId && clientSecret) return { clientId, clientSecret }
  throw new UsageError('Set ASTRID_TOKEN, or ASTRID_CLIENT_ID and ASTRID_CLIENT_SECRET')
}

function readSeen(file: string): Set<string> {
  if (!existsSync(file)) return new Set()
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    // An unreadable file is an empty memory: the worst case is one extra run.
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [])
  } catch {
    return new Set()
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function packageVersion(): string {
  try {
    // Built as CommonJS: dist/cli.js sits one level under package.json.
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function queue(client: AstridClient, args: Parsed, io: CliIO): Promise<number> {
  const agent = args.flags.get('--agent')
  if (!agent) throw new UsageError('queue needs --agent <mailbox>')
  const seenFile = args.flags.get('--seen')
  if (args.switches.has('--write-seen') && !seenFile) throw new UsageError('--write-seen needs --seen <file>')

  let snapshot
  try {
    snapshot = await client.getQueue({
      agent,
      listId: args.flags.get('--list'),
      includeUnassigned: args.switches.has('--include-unassigned'),
    })
  } catch (error) {
    io.stderr(`QUEUE: unknown — ${message(error)}`)
    return EXIT.ERROR
  }
  for (const skipped of snapshot.attention?.skipped ?? []) io.stderr(`ATTENTION: ${skipped}`)

  const verdict = decideQueueVerdict({ snapshot, seen: seenFile ? readSeen(seenFile) : new Set() })
  // stdout is one JSON document a caller can pipe to jq; the log line goes to stderr.
  io.stdout(JSON.stringify({
    version: 1,
    work: verdict.work,
    reason: verdict.reason,
    summary: verdict.line,
    wakeKeys: verdict.keys,
    snapshot,
  }, null, 2))
  io.stderr(verdict.line)

  if (seenFile && args.switches.has('--write-seen')) {
    // The CURRENT set, not an accumulation: an answered reply drops out.
    try {
      mkdirSync(dirname(seenFile), { recursive: true })
      writeFileSync(seenFile, `${JSON.stringify(verdict.keys, null, 2)}\n`)
    } catch (error) {
      io.stderr(`SEEN: could not write ${seenFile} — ${message(error)}`)
    }
  }
  return verdict.work ? EXIT.WORK : EXIT.IDLE
}

async function claim(client: AstridClient, args: Parsed, io: CliIO): Promise<number> {
  const taskId = args.positional[1]
  if (!taskId) throw new UsageError('claim needs a task id')
  const agent = args.flags.get('--agent')
  const resume = args.switches.has('--resume')

  if (args.switches.has('--fixall')) {
    if (resume) throw new UsageError('--fixall --resume needs a watermark and resume context; use scripts/claim-fixall-task.ts')
    const result = await client.claimFixallTask(taskId, {
      action: 'ready',
      ...(agent ? { agent } : {}),
      ...(args.flags.get('--list') ? { listId: args.flags.get('--list') } : {}),
    })
    if (!result.claimed) {
      // A lost race and "no active agent account" are both 409; print the
      // server's reason so a caller does not chase a peer that is not there.
      io.stderr(`CLAIM_CONFLICT ${taskId}: claimed by someone else, or no longer eligible${result.error ? ` — server said: ${result.error}` : ''}`)
      return EXIT.CONFLICT
    }
    io.stdout(`CLAIMED ${taskId}`)
    // A scheduled runner collects its claims and releases any left in Doing after the run.
    const claimsFile = io.env.ASTRID_FIXALL_CLAIMS_FILE
    if (claimsFile) appendFileSync(claimsFile, `${taskId}\n`)
    return EXIT.WORK
  }

  const leaseSeconds = resume ? undefined : leaseSecondsOf(args)
  const result = await client.claimTask(taskId, {
    action: resume ? 'resume' : 'claim',
    ...(agent ? { agentMailbox: agent } : {}),
    ...(leaseSeconds !== undefined ? { leaseSeconds } : {}),
  })
  if (result.outcome === 'claimed' || (resume && result.outcome === 'already_yours')) {
    io.stdout(`${resume ? 'RESUMED' : 'CLAIMED'} ${taskId}`)
    return EXIT.WORK
  }
  if (result.outcome === 'unavailable') {
    io.stderr(`CLAIM ${taskId}: the claim API is unavailable on this server (HTTP ${result.status})`)
    return EXIT.ERROR
  }
  // already_yours on a fresh claim means another worker on this mailbox holds it.
  // A 409 is a lost race, a task no longer Ready, or a bound board at capacity.
  if (result.outcome === 'already_yours' || result.status === 409) {
    io.stderr(`CLAIM_CONFLICT ${taskId}: ${result.outcome}`)
    return EXIT.CONFLICT
  }
  io.stderr(`CLAIM ${taskId}: ${result.outcome} (HTTP ${result.status})`)
  return EXIT.ERROR
}

function leaseSecondsOf(args: Parsed): number | undefined {
  const raw = args.flags.get('--lease-seconds')
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600) {
    throw new UsageError('--lease-seconds must be a whole number from 60 to 3600')
  }
  return seconds
}

async function heartbeat(client: AstridClient, args: Parsed, io: CliIO): Promise<number> {
  const taskId = args.positional[1]
  if (!taskId) throw new UsageError('heartbeat needs a task id')
  const agent = args.flags.get('--agent')
  const leaseSeconds = leaseSecondsOf(args)
  const result = await client.heartbeatTask(taskId, {
    ...(agent ? { agentMailbox: agent } : {}),
    ...(leaseSeconds !== undefined ? { leaseSeconds } : {}),
  })
  if (result.outcome === 'renewed') {
    io.stdout(`RENEWED ${taskId}${result.task?.claimLeaseExpiresAt ? ` until ${result.task.claimLeaseExpiresAt}` : ''}`)
    return EXIT.WORK
  }
  if (result.outcome === 'unavailable') {
    io.stderr(`HEARTBEAT ${taskId}: the claim API is unavailable on this server (HTTP ${result.status})`)
    return EXIT.ERROR
  }
  // The task left Doing, or someone else holds it: the claim is gone, stop work.
  if (result.status === 409) {
    io.stderr(`HEARTBEAT_LOST ${taskId}: ${result.outcome}`)
    return EXIT.CONFLICT
  }
  io.stderr(`HEARTBEAT ${taskId}: ${result.outcome} (HTTP ${result.status})`)
  return EXIT.ERROR
}

async function release(client: AstridClient, args: Parsed, io: CliIO): Promise<number> {
  const taskId = args.positional[1]
  if (!taskId) throw new UsageError('release needs a task id')
  const comment = args.flags.get('--comment')
  // Say why before the claim goes: after release the task may leave this agent's view.
  if (comment) await client.addComment(taskId, comment)
  const result = await client.releaseTask(taskId, args.flags.get('--agent'))
  if (result.outcome === 'released') {
    io.stdout(`RELEASED ${taskId}`)
    return EXIT.WORK
  }
  if (result.outcome === 'unavailable') {
    io.stderr(`RELEASE ${taskId}: the claim API is unavailable on this server (HTTP ${result.status})`)
    return EXIT.ERROR
  }
  if (result.status === 409) {
    io.stderr(`RELEASE_CONFLICT ${taskId}: ${result.outcome}`)
    return EXIT.CONFLICT
  }
  io.stderr(`RELEASE ${taskId}: ${result.outcome} (HTTP ${result.status})`)
  return EXIT.ERROR
}

/** Runs one command and resolves to its exit code. Never calls process.exit. */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let args: Parsed
  try {
    args = parse(argv)
  } catch (error) {
    io.stderr(`${message(error)}\n\n${USAGE}`)
    return EXIT.ERROR
  }
  if (args.switches.has('--help') || args.switches.has('-h')) {
    io.stdout(USAGE)
    return 0
  }
  if (args.switches.has('--version') || args.switches.has('-v')) {
    io.stdout(packageVersion())
    return 0
  }

  const command = args.positional[0]
  const handlers: Record<string, typeof queue> = { queue, claim, heartbeat, release }
  const handler = command ? handlers[command] : undefined
  if (!handler) {
    io.stderr(`${command ? `Unknown command "${command}"` : 'No command given'}\n\n${USAGE}`)
    return EXIT.ERROR
  }

  try {
    const client = new AstridClient({
      origin: args.flags.get('--origin') || io.env.ASTRID_API_URL || io.env.ASTRID_API_BASE_URL,
      auth: authFrom(io.env),
      ...(io.fetch ? { fetch: io.fetch } : {}),
    })
    return await handler(client, args, io)
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n\n${USAGE}`)
    } else {
      const status = error instanceof AstridApiError ? ` (HTTP ${error.status})` : ''
      io.stderr(`${command}: failed${status} — ${message(error)}`)
    }
    return EXIT.ERROR
  }
}
