/**
 * The scheduled loop must not start a run into a machine that is already
 * buried (AWTD-1207).
 *
 * WHAT WENT WRONG. On 2026-10-10 two runs took a task, wrote the fix, and then
 * could not get a green gate: `npm run predeploy` went red twice on test
 * timeouts in different, unrelated files each time, with the machine's load
 * average above 120 on 8 cores. Every one of those tests passes alone. The
 * runs burned ~40 minutes between them and auto-filed failure tasks for
 * nothing (AWTD-1192, closed as exactly that; AWTD-1197). This Mac also runs
 * the iOS loop's simulator UI tests and two self-hosted Actions runners, so
 * the overlap is routine rather than freak.
 *
 * WHY THE 5-MINUTE AVERAGE. The 1-minute figure spikes on anything — a
 * Spotlight pass, opening Xcode — and a tick that skipped on a spike would
 * lose work for no reason. A run lasts up to 75 minutes, so what matters is
 * whether the machine has been buried for a while, which is what the 5-minute
 * figure says.
 *
 * WHY A SKIP AND NOT A WAIT. The next tick is 30 minutes away and costs
 * nothing; a run that waits holds the working-tree lock while it does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const guard = loop.slice(loop.indexOf('# ── Guard 2b'), loop.indexOf('rm -f "$STUCK_FILE"'))

let dir: string
let bin: string

function sysctl(loadavg: string, ncpu = '8'): void {
  const path = join(bin, 'sysctl')
  writeFileSync(
    path,
    `#!/bin/bash\ncase "$2" in\n  vm.loadavg) echo '${loadavg}' ;;\n  hw.ncpu) echo '${ncpu}' ;;\n  *) exit 1 ;;\nesac\n`,
    'utf8',
  )
  chmodSync(path, 0o755)
}

function run(env: Record<string, string> = {}): string {
  // skip_tracked is the shared tracker, proven by its own test; here it only
  // has to report, so the guard's decision is what this file measures.
  const script = `skip_tracked() { echo "RESULT: SKIPPED — $1"; exit 0; }\n${guard}\necho "FELL THROUGH"`
  return execFileSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    // FIXALL_SYSCTL, not PATH: on Linux `sysctl` exists but answers neither
    // vm.loadavg nor hw.ncpu, so a PATH-stubbed test passed on macOS and fell
    // through silently on CI.
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, FIXALL_SYSCTL: join(bin, 'sysctl'), ...env },
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixall-load-'))
  bin = join(dir, 'bin')
  mkdirSync(bin)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the scheduled loop waits out a buried machine', () => {
  it('skips when the 5-minute load is past the per-core budget, naming what it saw', () => {
    sysctl('{ 2.00 41.21 46.18 }') // 41.21 on 8 cores = 5.2 per core, past the default 4
    const out = run()
    expect(out).toContain('RESULT: SKIPPED')
    expect(out).toMatch(/41\.21/)
    expect(out).not.toContain('FELL THROUGH')
  })

  it('ignores a 1-minute spike — only a sustained load blocks a run', () => {
    sysctl('{ 101.13 5.00 4.00 }')
    const out = run()
    expect(out).toContain('FELL THROUGH')
    // Says what it compared. Without this the first two CI failures printed
    // nothing but "FELL THROUGH", which cannot distinguish "looked and the box
    // was idle" from "could not look at all" — and the real cause was neither.
    expect(out).toMatch(/load ok — 5-minute average 5\.00 against a budget of 32/)
  })

  it('decides it in the shell, not in awk', () => {
    // `awk 'BEGIN { exit !(load > max) }'` answered one way on macOS and the
    // other under mawk on Linux CI, with the same inputs and no output either
    // way. The threshold does not need the fraction.
    const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
    const block = loop.slice(loop.indexOf('# ── Guard 2b'), loop.indexOf('rm -f "$STUCK_FILE"'))
    expect(block).toMatch(/\[ "\$LOAD_INT" -gt "\$MAX_LOAD" \]/)
    expect(block).not.toMatch(/awk -v load/)
  })

  it('scales the budget to the machine, not to a fixed number', () => {
    sysctl('{ 2.00 41.21 46.18 }', '32') // same load, 32 cores = 1.3 per core
    expect(run()).toContain('FELL THROUGH')
  })

  it('takes an explicit ceiling over the per-core default', () => {
    sysctl('{ 2.00 41.21 46.18 }')
    expect(run({ FIXALL_MAX_LOAD: '200' })).toContain('FELL THROUGH')
    expect(run({ FIXALL_MAX_LOAD_PER_CPU: '16' })).toContain('FELL THROUGH')
  })

  it('is bypassed by FIXALL_FORCE, like every other guard', () => {
    sysctl('{ 2.00 41.21 46.18 }')
    expect(run({ FIXALL_FORCE: '1' })).toContain('FELL THROUGH')
  })

  it('runs rather than stalls when the load cannot be read — and says so', () => {
    writeFileSync(join(bin, 'sysctl'), '#!/bin/bash\nexit 1\n', 'utf8')
    chmodSync(join(bin, 'sysctl'), 0o755)
    const out = run()
    expect(out).toContain('FELL THROUGH')
    // Silence here is what made the first CI failure unreadable: a guard that
    // could not look must not be mistaken for one that looked and saw an idle box.
    expect(out).toContain('could not read the load')
  })

  it('is not satisfied by a sysctl that merely exists, as on Linux', () => {
    // `sysctl -n vm.loadavg` is a BSD/macOS key; Linux's sysctl exits non-zero.
    writeFileSync(join(bin, 'sysctl'), '#!/bin/bash\necho "error: unknown key" >&2\nexit 1\n', 'utf8')
    chmodSync(join(bin, 'sysctl'), 0o755)
    expect(run()).toContain('could not read the load')
  })
})
