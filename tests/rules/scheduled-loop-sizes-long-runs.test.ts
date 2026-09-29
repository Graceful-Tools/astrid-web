/**
 * AWTD-1041: a task flagged LONG-RUN gets a watchdog sized for it, and only
 * inside the long-run window.
 *
 * The decision is scripts/lib/long-run.ts (tests/scripts/long-run.test.ts).
 * This holds the WIRING: the preflight must be asked for a plan, and the loop
 * must apply what it answers — the watchdog, the budget, and which tasks the
 * session may take. The sizing block is RUN here against canned preflight
 * output rather than pattern-matched, since what matters is the values it
 * leaves behind.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const sizing = loop.slice(loop.indexOf('# ── Size the run'), loop.indexOf('# ── Can this machine'))
const preflight = loop.match(/QUEUE_OUT=\$\([^\n]*agent-queue-status\.ts[^\n]*/)?.[0] ?? ''

function size(queueOut: string, env: Record<string, string> = {}): Record<string, string> {
  const script = [
    'MAX_MINUTES=75',
    'MAX_USD="${FIXALL_MAX_USD-10}"',
    sizing,
    'echo "MAX_MINUTES=$MAX_MINUTES"',
    'echo "MAX_USD=$MAX_USD"',
    'echo "NEXT=${ASTRID_FIXALL_NEXT_TASK-}"',
    'echo "DEFER=${ASTRID_FIXALL_DEFER_TASKS-}"',
  ].join('\n')
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', QUEUE_OUT: queueOut, ...env } })
  return Object.fromEntries(
    out
      .split('\n')
      .filter(line => /^[A-Z_]+=/.test(line))
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

describe('the scheduled loop sizes a LONG-RUN task (AWTD-1041)', () => {
  it('asks the preflight for a run plan with the window, the default watchdog and the task cap', () => {
    expect(preflight).toMatch(/--long-run-window "\$LONG_RUN_WINDOW"/)
    expect(preflight).toMatch(/--default-minutes "\$MAX_MINUTES"/)
    expect(preflight).toMatch(/--max-tasks "\$ASTRID_FIXALL_MAX_TASKS"/)
  })

  it('has a sizing block to apply the plan', () => {
    expect(sizing.length).toBeGreaterThan(0)
  })

  it('keeps the ordinary watchdog and budget for an ordinary task', () => {
    const out = size('RUN-MINUTES: 75\nRUN-TASK: t1\nQUEUE: 1 task ready')
    expect(out.MAX_MINUTES).toBe('75')
    expect(out.MAX_USD).toBe('10')
    expect(out.NEXT).toBe('t1')
    expect(out.DEFER).toBe('')
  })

  it('stretches the watchdog and the budget for a long run', () => {
    const out = size('RUN-MINUTES: 480\nRUN-LONG: 1\nRUN-TASK: t9\nQUEUE: 1 task ready')
    expect(out.MAX_MINUTES).toBe('480')
    expect(out.MAX_USD).toBe('50')
    expect(out.NEXT).toBe('t9')
  })

  it('honours FIXALL_LONG_MAX_USD, and an explicitly unbounded budget stays unbounded', () => {
    expect(size('RUN-MINUTES: 480\nRUN-LONG: 1', { FIXALL_LONG_MAX_USD: '30' }).MAX_USD).toBe('30')
    expect(size('RUN-MINUTES: 480\nRUN-LONG: 1', { FIXALL_MAX_USD: '' }).MAX_USD).toBe('')
  })

  it('tells the session which tasks were deferred to the window', () => {
    const out = size('RUN-MINUTES: 75\nRUN-TASK: t2\nRUN-DEFER: t1,t3\nQUEUE: 1 task ready')
    expect(out.DEFER).toBe('t1,t3')
  })

  it('ignores a malformed watchdog rather than running without one', () => {
    expect(size('RUN-MINUTES: soon').MAX_MINUTES).toBe('75')
    expect(size('QUEUE: 1 task ready').MAX_MINUTES).toBe('75')
  })

  it('passes the plan to /fixall, whose shared workflow must honour it', () => {
    // .claude/commands/fixall.md sends every run to this file for the workflow.
    const workflow = readFileSync(join(process.cwd(), 'docs/FIXALL_WORKFLOW.md'), 'utf8')
    expect(workflow).toMatch(/take that task first[\s\S]*ASTRID_FIXALL_NEXT_TASK|ASTRID_FIXALL_NEXT_TASK[\s\S]*take that task first/)
    expect(workflow).toMatch(/Never take a task listed in `ASTRID_FIXALL_DEFER_TASKS`/)
  })
})
