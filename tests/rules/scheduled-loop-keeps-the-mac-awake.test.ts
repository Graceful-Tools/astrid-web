/**
 * A scheduled /fixall run must not be lost to the Mac falling asleep (AWTD-1207).
 *
 * WHAT WENT WRONG. On 2026-10-07 only 30 of the day's 48 ticks fired and on
 * 2026-10-08 only 38 — whole hours missing from the log while the machine
 * slept. Nothing in either loop asserted wakefulness, so a run that had
 * already started was equally exposed: FIXALL_MAX_MINUTES allows 75 minutes,
 * and idle sleep inside that window kills the run mid-task, which guard 2 then
 * rightly refuses to clean up after.
 *
 * WHY `-w` AND NOT A WRAPPER. `caffeinate <utility>` would make caffeinate the
 * child this script waits on, and the watchdog's `kill -TERM "$CLAUDE_PID"`
 * would land on caffeinate while the real run kept going — exactly the wedged
 * run the watchdog exists to stop, since launchd starts no second copy of a
 * live label. Asserting against the claude pid with `-w` keeps one process to
 * kill and lets the assertion end with the run on its own.
 *
 * The run block is RUN here against stub `claude` and `caffeinate` binaries,
 * rather than pattern-matched: what matters is which pid each one gets.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const runBlock = loop.slice(loop.indexOf('# ── The run ──'), loop.indexOf('# ── Leave the checkout'))

let dir: string
let bin: string

/** A stub that records its argv, one call per line. */
function stub(name: string, body: string): void {
  const path = join(bin, name)
  writeFileSync(path, `#!/bin/bash\n${body}\n`, 'utf8')
  chmodSync(path, 0o755)
}

function run(env: Record<string, string>): string {
  stub('caffeinate', `echo "$@" >> "${join(dir, 'caffeinate.args')}"`)
  // Output goes to a FILE, never through execFileSync's pipe. The watchdog is a
  // backgrounded subshell and killing it orphans its `sleep`, which keeps the
  // inherited stdout open — a captured pipe would block for the whole watchdog
  // interval instead of returning when the run ends.
  const outFile = join(dir, 'out.txt')
  const script = `exec > "${outFile}" 2>&1\npost_to_list() { :; }\n${runBlock}\necho "STATUS=$STATUS"`
  execFileSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: dir,
      TMPDIR: dir,
      MODEL: 'opus',
      MAX_USD: '',
      CLAUDE: join(bin, 'claude'),
      ...env,
    },
  })
  return readFileSync(outFile, 'utf8')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixall-awake-'))
  bin = join(dir, 'bin')
  mkdirSync(bin)
  // Records its own pid, then lives for STUB_SLEEP seconds so the pid is real
  // while caffeinate is being started.
  stub('claude', `echo $$ > "${join(dir, 'claude.pid')}"\nsleep "\${STUB_SLEEP:-0.2}"`)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the scheduled loop keeps the Mac awake for the whole run', () => {
  it('asserts wakefulness for the life of the run, against the run’s own pid', () => {
    // STUB_SLEEP: the loop kills caffeinate as soon as the run ends, and a run
    // that exits instantly would be gone before the stub is ever scheduled.
    const out = run({ MAX_MINUTES: '1', STUB_SLEEP: '0.5' })
    expect(out).toContain('STATUS=0')

    const args = readFileSync(join(dir, 'caffeinate.args'), 'utf8').trim()
    const claudePid = readFileSync(join(dir, 'claude.pid'), 'utf8').trim()

    // -i: no idle system sleep. -w <pid>: for exactly as long as the run lives.
    expect(args).toMatch(/(^|\s)-i(\s|$)/)
    expect(args).toContain(`-w ${claudePid}`)
  })

  it('leaves the display alone — this is a headless run, not a presentation', () => {
    run({ MAX_MINUTES: '1', STUB_SLEEP: '0.5' })
    const args = readFileSync(join(dir, 'caffeinate.args'), 'utf8')
    expect(args).not.toMatch(/(^|\s)-d(\s|$)/)
  })

  it('still lets the watchdog kill the run — caffeinate must not become the child we wait on', () => {
    // MAX_MINUTES=0 fires the watchdog at once; the stub would otherwise live 5s.
    const out = run({ MAX_MINUTES: '0', STUB_SLEEP: '5' })
    expect(out).toContain('STATUS=143')
  })

  it('runs anyway, and says so, when there is no caffeinate to assert with', () => {
    // Through the seam, not through PATH: caffeinate ships in /usr/bin, so a
    // PATH-only test would quietly exercise the real binary and prove nothing.
    const out = run({ MAX_MINUTES: '1', FIXALL_CAFFEINATE: '/nonexistent/caffeinate' })
    expect(out).toContain('STATUS=0')
    expect(out).toContain('no caffeinate at /nonexistent/caffeinate')
    expect(existsSync(join(dir, 'caffeinate.args'))).toBe(false)
  })

  it('can be turned off entirely, and then says nothing about it', () => {
    const out = run({ MAX_MINUTES: '1', FIXALL_CAFFEINATE: '' })
    expect(out).toContain('STATUS=0')
    expect(out).not.toContain('caffeinate')
    expect(existsSync(join(dir, 'caffeinate.args'))).toBe(false)
  })
})

/**
 * The weekly review is the other unattended run on this laptop, and the longest.
 * It has no watchdog holding a pid, so the wrapper form is the right one there —
 * caffeinate exits with the utility's own status, so `$?` still reads the
 * review's. Asserted on the source because the surrounding script sets up a
 * worktree and installs dependencies before it ever reaches this line.
 */
describe('the weekly hygiene review keeps the Mac awake too', () => {
  const review = readFileSync(join(process.cwd(), 'scripts/weekly-hygiene-review.sh'), 'utf8')

  it('runs claude under caffeinate', () => {
    expect(review).toMatch(/CAFFEINATE=\(caffeinate -i -m\)/)
    expect(review).toMatch(/"\$\{CAFFEINATE\[@\]\}" "\$CLAUDE" -p/)
  })

  it('still reports the review’s own exit status', () => {
    const afterRun = review.slice(review.indexOf('"${CAFFEINATE[@]}" "$CLAUDE" -p'))
    expect(afterRun).toMatch(/STATUS=\$\?/)
    expect(afterRun).toMatch(/exit \$STATUS/)
  })

  it('degrades to running without it', () => {
    expect(review).toContain('no caffeinate on PATH')
  })
})
