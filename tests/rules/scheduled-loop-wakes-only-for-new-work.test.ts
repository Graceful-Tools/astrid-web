/**
 * The scheduled /fixall loop must be free when idle and must wake for
 * everything the run is required to act on — and only once per item.
 *
 * Guard 3 of scripts/fixall-loop.sh decides whether a tick boots a Claude
 * session. On 2026-09-20 it decided from the endpoint's `empty` flag alone,
 * which describes the Ready queue and nothing else, so:
 *
 *   - two direct questions from Jon sat in `attention` while the log said
 *     "nothing queued" every half hour, and
 *   - a date-parked Waiting task could never come back on its own: the sweep
 *     that promotes it ran only inside a session, and a session needed a
 *     non-empty queue to start.
 *
 * The fix routes the decision through scripts/lib/agent-queue-verdict.ts
 * (tests/scripts/agent-queue-verdict.test.ts holds the rules). This file
 * holds the WIRING: the loop must pass the board so the sweep runs, and the
 * status script must actually use the verdict rather than its own `empty`
 * check. Either regressing looks exactly like a quiet day.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const LOOP = 'scripts/fixall-loop.sh'
const STATUS = 'scripts/agent-queue-status.ts'

const loop = readFileSync(join(ROOT, LOOP), 'utf8')
const status = readFileSync(join(ROOT, STATUS), 'utf8')

describe('the scheduled loop wakes only for new work', () => {
  it('asks the status script to sweep the web board, so parked work can wake it', () => {
    // The invocation, not the comment that mentions the script above it.
    const call = loop.match(/QUEUE_OUT=\$\([^\n]*agent-queue-status\.ts[^\n]*/)?.[0] ?? ''
    expect(call, `${LOOP} must pass --board web to ${STATUS}`).toMatch(/--board web\b/)
  })

  it('decides through the tested verdict, not the endpoint flag alone', () => {
    expect(status).toMatch(/decideQueueVerdict\(/)
    // The old shape. If it comes back, the inbox goes deaf again.
    expect(status, `${STATUS} must not decide from result.empty`).not.toMatch(/if\s*\(\s*!?result\.empty\s*\)/)
  })

  it('runs the sweep as the agent whose queue it reads', () => {
    // A sweep run as the wrong harness touches the wrong tasks. The selector
    // has to come from the same --agent the endpoint is asked about.
    expect(status).toMatch(/harnessForMailbox\(mailbox\)/)
    expect(status).toMatch(/'--harness',\s*harness/)
  })

  it('bounds waking with a seen-file by default, not only when asked', () => {
    // The iOS loop calls this script with no flags; an unanswered item there
    // must not become a session every tick either.
    expect(status).toMatch(/arg\('--seen'\)\s*\?\?\s*defaultSeenFile\(/)
  })

  it('keeps the default seen-file out of node_modules', () => {
    // node_modules/.cache was wiped by every `npm ci`, and the next tick woke
    // every unanswered item at once. The default belongs in the OS cache dir;
    // node_modules survives only in the one-time legacy adoption path.
    const seenLib = readFileSync(join(ROOT, 'scripts/lib/fixall-seen-file.ts'), 'utf8')
    const defaultFn = seenLib.match(/export function defaultSeenFile\([\s\S]*?\n\}/)?.[0] ?? ''
    expect(defaultFn, 'defaultSeenFile must not point at node_modules').not.toMatch(/node_modules/)
    expect(defaultFn).toMatch(/Caches/)
  })

  it('keeps the skip line honest about what was checked', () => {
    // "nothing queued" was true and misleading. The log line is what a person
    // reads to decide whether the loop is healthy.
    expect(loop).toMatch(/RESULT: SKIPPED — nothing to do for claude \(no Ready task, no new comment, no lane work\)/)
  })
})
