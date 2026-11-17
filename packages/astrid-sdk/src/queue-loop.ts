/**
 * `astrid-agent queue --lines`: the contract the scheduled loops' launchers
 * parse (ADEV-83). Moved from astrid-web's scripts/agent-queue-status.ts, which
 * is now a shim over it, so the web, iOS, Android and Windows loops all read
 * one implementation.
 *
 * The output is lines, not JSON, because a launcher greps them out of a log:
 *
 *   QUEUE: <verdict>          one per run (`QUEUE: unknown — …` and exit 1 when it could not tell)
 *   KEYS: ["comment:…", …]    with --no-write-seen: the keys that woke this run
 *   SEEN: …                   seen-file bookkeeping
 *   RUN-MINUTES / RUN-LONG / RUN-TASK / RUN-DEFER / RUN:   with --long-run-window, the run plan
 *
 * Waking is bounded by a seen-file (default: the OS cache dir, per agent and
 * list) and is two-phase: a preflight with `--no-write-seen` computes the
 * verdict and hands its keys back; the run's outcome records them with
 * `--mark-seen --seen-keys '<json>'` (finished) or `--mark-seen --failed …`
 * (a strike per key, muted after MAX_FAILED_ATTEMPTS). A run that crashes must
 * not mute the items that woke it on its first failure. Without
 * `--no-write-seen` the preflight writes the seen-file itself, the old behavior.
 *
 * Exit codes: 0 there is work, 3 nothing to do, 1 could not tell. A caller
 * must NOT treat 1 as empty.
 */

import { AstridClient } from './client.js'
import { findBoardList, parseBoardTarget } from './board.js'
import { DEFAULT_LONG_RUN_WINDOW, parseLongRunWindow, planRun } from './long-run.js'
import {
  adoptLegacySeenFile,
  attemptsFileFor,
  defaultSeenFile,
  readAttempts,
  readSeen,
  readSeenKeysInput,
  writeJson,
} from './seen-file.js'
import { decideQueueVerdict, type QueueSnapshot } from './verdict.js'
import { MAX_FAILED_ATTEMPTS, recordFailedRun, recordFinishedRun } from './wake-keys.js'

/** The slice of the parsed command line this mode reads. */
export interface LoopArgs {
  flag(name: string): string | undefined
  has(name: string): boolean
}

export interface LoopIO {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

const EXIT = { WORK: 0, ERROR: 1, IDLE: 3 } as const

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The seen-file for this agent and list: `--seen`, else the OS cache dir; a legacy file is adopted once. */
function seenFileFor(args: LoopArgs, agent: string, listId: string, io: LoopIO): string {
  const given = args.flag('--seen')
  if (given) return given
  const seenFile = defaultSeenFile(agent, listId)
  if (!args.has('--dry-run')) {
    // One-time move of the pre-2026-09-21 default, so a deploy does not
    // re-wake every item the old file had already muted.
    const adopted = adoptLegacySeenFile(agent, listId, seenFile)
    if (adopted) io.stdout(`SEEN: adopted legacy seen-file at ${adopted}`)
  }
  return seenFile
}

function writeOrSay(file: string, value: unknown, io: LoopIO): boolean {
  const failure = writeJson(file, value)
  if (failure !== null) io.stdout(`SEEN: could not write ${file} — ${failure}`)
  return failure === null
}

/** Phase two of waking: record the keys a run was woken for, by how it ended. No network. */
export function markSeen(args: LoopArgs, io: LoopIO): number {
  const agent = args.flag('--agent') || 'claude'
  const listId = args.flag('--list')
  if (args.has('--dry-run')) throw new Error('--dry-run cannot mark seen keys')
  if (!listId && !args.flag('--seen')) throw new Error('--mark-seen needs --list <listId> (or --seen <file>)')
  const keys = readSeenKeysInput(args.flag('--seen-keys'), args.flag('--seen-keys-file'))
  const seenFile = seenFileFor(args, agent, listId ?? '', io)
  const attemptsFile = attemptsFileFor(seenFile)
  const seen = readSeen(seenFile)
  const attempts = readAttempts(attemptsFile)

  if (args.has('--failed')) {
    const failed = recordFailedRun(seen, keys, attempts)
    const ok = writeOrSay(attemptsFile, failed.attempts, io) &&
      (failed.exhausted.length === 0 || writeOrSay(seenFile, failed.seen, io))
    io.stdout(
      `SEEN: run failed — ${failed.exhausted.length} of ${keys.length} keys reached ${MAX_FAILED_ATTEMPTS} attempts and are muted` +
        (ok ? '' : ' (not recorded)'),
    )
    return ok ? EXIT.WORK : EXIT.ERROR
  }
  const finished = recordFinishedRun(seen, keys, attempts)
  const ok = writeOrSay(seenFile, finished.seen, io) && writeOrSay(attemptsFile, finished.attempts, io)
  io.stdout(`SEEN: marked ${keys.length} keys as seen${ok ? '' : ' (not recorded)'}`)
  return ok ? EXIT.WORK : EXIT.ERROR
}

export async function loopQueue(client: AstridClient, args: LoopArgs, io: LoopIO): Promise<number> {
  const agent = args.flag('--agent') || 'claude'
  const board = args.flag('--board')
  const dryRun = args.has('--dry-run')
  const asJson = args.has('--json')

  if (board) parseBoardTarget({ board })
  let listId = args.flag('--list')
  if (!listId && board) {
    const target = parseBoardTarget({ board })
    // `--board` resolves the id by NAME on every run: a stale id reads as an empty board.
    if (target?.kind === 'board') listId = findBoardList(await client.getLists(), target.board).id
  }
  if (!listId) {
    io.stderr('Usage: astrid-agent queue --lines --agent <mailbox> --list <listId> [--board web|ios|windows|android] [--seen <file>]')
    return EXIT.ERROR
  }
  const seenFile = seenFileFor(args, agent, listId, io)

  const query = { agent, listId, includeUnassigned: args.has('--include-unassigned') }
  const fetched: QueueSnapshot & { mode?: string } = await client.getQueue(query)
  // Dispatch twice is worse than not at all: a webhook-mode agent is woken by the server.
  if (args.has('--require-polling') && fetched.mode !== 'polling') {
    throw new Error(`Agent ${agent} mode is "${fetched.mode}", not polling — refusing duplicate dispatch`)
  }
  for (const skipped of fetched.attention?.skipped ?? []) io.stderr(`ATTENTION: ${skipped}`)

  // Long runs (AWTD-1041), opt-in so other loops' calls are unchanged. The plan
  // is applied to the queue BEFORE the verdict: a long task deferred to its
  // window is not work this tick, and a queue holding only that must read as
  // idle, not start a session that has nothing it may take.
  let snapshot: QueueSnapshot = fetched
  const windowSpec = args.flag('--long-run-window')
  if (windowSpec !== undefined) {
    const parsed = parseLongRunWindow(windowSpec)
    if (!parsed) {
      io.stdout(`RUN: long-run window "${windowSpec}" is not <start>-<end> or "always" — using ${DEFAULT_LONG_RUN_WINDOW}`)
    }
    const plan = planRun({
      queue: fetched.queue,
      hour: new Date().getHours(),
      defaultMinutes: Number(args.flag('--default-minutes') ?? 75),
      window: parsed ?? parseLongRunWindow(DEFAULT_LONG_RUN_WINDOW)!,
      maxTasks: Number(args.flag('--max-tasks') ?? 1),
    })
    snapshot = { ...fetched, queue: plan.queue, empty: plan.queue.length === 0 }
    io.stdout(`RUN-MINUTES: ${plan.maxMinutes}`)
    if (plan.long) io.stdout('RUN-LONG: 1')
    if (plan.nextTask) io.stdout(`RUN-TASK: ${plan.nextTask.id}`)
    if (plan.deferred.length > 0) io.stdout(`RUN-DEFER: ${plan.deferred.map(task => task.id).join(',')}`)
    if (plan.note) io.stdout(`RUN: ${plan.note}`)
  }

  const verdict = decideQueueVerdict({ snapshot, seen: readSeen(seenFile) })
  const deferSeen = args.has('--no-write-seen') || dryRun
  const output = args.flag('--output')
  if (output) {
    const failure = writeJson(output, {
      version: 1, listId, work: verdict.work, reason: verdict.reason,
      // `lanes` stays in version 1, always empty: the server settles Waiting now.
      wakeKeys: verdict.keys, snapshot, lanes: [],
    })
    if (failure !== null) throw new Error('Could not persist preflight output')
  }

  if (asJson) {
    // The keys ride inside the document, so a JSON caller can still hand them back to --mark-seen.
    io.stdout(JSON.stringify(deferSeen ? { ...snapshot, wakeKeys: verdict.keys } : snapshot, null, 2))
  } else {
    io.stdout(verdict.line)
  }

  // The write is the second phase of waking. With --no-write-seen the keys are
  // handed back as a KEYS: line instead, and the run's outcome records them via
  // --mark-seen. Without it every wake-able item present now has had its chance
  // after this tick, whether the run starts or not.
  if (deferSeen) {
    if (!asJson) io.stdout(`KEYS: ${JSON.stringify(verdict.keys)}`)
  } else {
    writeOrSay(seenFile, verdict.keys, io)
  }
  return verdict.work ? EXIT.WORK : EXIT.IDLE
}

/** Everything thrown is "could not tell": exit 1, never idle. */
export function couldNotTell(error: unknown, io: LoopIO): number {
  io.stderr(`QUEUE: unknown — ${message(error)}`)
  return EXIT.ERROR
}
