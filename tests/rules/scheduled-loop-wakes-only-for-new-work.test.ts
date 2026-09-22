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
    expect(status).toMatch(/arg\('--seen'\)\s*\?\?\s*join\(/)
  })

  it('keeps the skip line honest about what was checked', () => {
    // "nothing queued" was true and misleading. The log line is what a person
    // reads to decide whether the loop is healthy.
    expect(loop).toMatch(/RESULT: SKIPPED — nothing to do for claude \(no Ready task, no new comment, no lane work\)/)
  })

  it('does not burn wake keys on a preflight whose run may never happen (AWTD-986)', () => {
    // The status script used to write the seen-file the moment it computed
    // the verdict — before the loop had verified the claude binary, started
    // the run, or known it succeeded. A crashed, watchdog-killed, or
    // budget-exhausted run then muted its inbox/lane items forever: "one run
    // per item" became "one attempt ever". The preflight must defer the
    // write, and the script must honor the flag it is passed.
    const call = loop.match(/QUEUE_OUT=\$\([^\n]*agent-queue-status\.ts[^\n]*/)?.[0] ?? ''
    expect(call, `${LOOP} preflight must defer the seen-file write`).toMatch(/--no-write-seen\b/)
    expect(status, `${STATUS} must honor --no-write-seen`).toMatch(/process\.argv\.includes\('--no-write-seen'\)/)
  })

  it('records wake keys by how the run ended, before its RESULT line (AWTD-986)', () => {
    // The invocations, not the comments that describe them: a finished run
    // marks its keys seen, a failed one gives them a strike, and both happen
    // before the RESULT line so that line stays the last one in the log.
    const calls = [...loop.matchAll(/^\s*"\$TSX" scripts\/agent-queue-status\.ts[^\n]*--mark-seen[^\n]*$/gm)].map(m => m[0])
    expect(calls, `${LOOP} must call --mark-seen for a finished run and --mark-seen --failed for a failed one`).toHaveLength(2)
    expect(calls.some(c => /--mark-seen --seen-keys/.test(c))).toBe(true)
    expect(calls.some(c => /--mark-seen --failed --seen-keys/.test(c))).toBe(true)
    // The run's own RESULT lines are the last two in the file; the earlier
    // RESULT: FAILED lines belong to guards that fire before any run starts,
    // where there are no consumed keys to record.
    const lastCall = calls.map(c => loop.indexOf(c)).sort((a, b) => b - a)[0]
    expect(lastCall, 'mark-seen must run before the RESULT lines').toBeLessThan(loop.lastIndexOf('echo "RESULT: OK'))
    expect(lastCall).toBeLessThan(loop.lastIndexOf('echo "RESULT: FAILED'))
    expect(status, `${STATUS} must handle --mark-seen`).toMatch(/process\.argv\.includes\('--mark-seen'\)/)
    expect(status, `${STATUS} must handle --failed`).toMatch(/process\.argv\.includes\('--failed'\)/)
  })

  it('bounds a run that keeps failing instead of re-waking it every tick (AWTD-986)', () => {
    // Removing the preflight write must not swing to the other extreme: a
    // run that dies the same way every time (watchdog, budget, crash) would
    // otherwise start a capped session every half hour, forever. The strike
    // limit lives in the tested helper and the script must use it.
    expect(status).toMatch(/recordFailedRun\(/)
    expect(status).toMatch(/recordFinishedRun\(/)
  })
})
