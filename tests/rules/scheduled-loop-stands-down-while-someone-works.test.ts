/**
 * A scheduled tick must stand down while someone is working this Mac (AWTD-1212).
 *
 * WHY THE LOCK WAS NOT ENOUGH. Guard 1 is per working TREE. On 2026-10-11 a
 * session worked astrid-web while the iOS loop ran a simulator suite and the
 * web loop ran predeploy: the 5-minute load average peaked over 890, and two
 * runs that day went red on test timeouts in files that pass alone, filing
 * failure tasks for nothing (AWTD-1192, AWTD-1197). Contention is per machine,
 * so the pause has to be too.
 *
 * The guard is RUN here against a stub `tsx`, because what matters is which
 * exit code becomes a skip and which becomes a run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const guard = loop.slice(loop.indexOf('# ── Guard 1b'), loop.indexOf('# ── Guard 2: never clobber'))

let dir: string
let bin: string

/** The loop asks through tsx; the exit code is the whole interface. */
function tsxYields(code: number, message: string): void {
  const path = join(bin, 'tsx')
  writeFileSync(path, `#!/bin/bash\necho "${message}"\nexit ${code}\n`, 'utf8')
  chmodSync(path, 0o755)
}

function run(): string {
  const script = `skip_tracked() { echo "RESULT: SKIPPED — $1"; exit 0; }\n${guard}\necho "FELL THROUGH"`
  return execFileSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    // NODE_ENV because this project's ProcessEnv declares it required, and
    // this env literal is deliberately minimal — the same reason 49b0ba2f gave
    // the three sibling loop tests theirs. Vitest does not typecheck, so only
    // predeploy's Test Tree Types gate sees it.
    env: { NODE_ENV: 'test', PATH: `${bin}:/usr/bin:/bin`, HOME: dir, TSX: join(bin, 'tsx') },
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixall-standdown-'))
  bin = join(dir, 'bin')
  mkdirSync(bin)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the scheduled loop stands down while someone works', () => {
  it('skips, and repeats the reason so the log and the board alert carry it', () => {
    tsxYields(2, 'claude-code (pid 999) is working /w/ios — this tick stands down')
    const out = run()
    expect(out).toContain('RESULT: SKIPPED')
    expect(out).toContain('claude-code (pid 999) is working /w/ios')
    expect(out).not.toContain('FELL THROUGH')
  })

  it('reports through the tracker, so a pause nobody lifts is announced', () => {
    // skip_tracked, never a bare echo + exit: that was the AWTD-1207 defect,
    // where the longest-lived skip was the one the alert could never fire for.
    expect(guard).toMatch(/skip_tracked "\$YIELD_OUT"/)
    expect(guard).not.toMatch(/echo "RESULT: SKIPPED/)
  })

  it('runs when nothing is paused', () => {
    tsxYields(0, '')
    expect(run()).toContain('FELL THROUGH')
  })

  it('runs anyway when the pause state cannot be read, and says so', () => {
    tsxYields(1, 'boom')
    const out = run()
    expect(out).toContain('could not read the pause state')
    expect(out).toContain('FELL THROUGH')
  })

  it('asks about OTHER sessions, not about itself', () => {
    // Both loops register as lock holders, so a loop that asked without
    // identifying itself would read its own registration and stand down forever.
    expect(guard).toMatch(/--self-pid \$\$/)
  })
})

describe('the loops register without pausing each other', () => {
  it('passes --scheduled when it takes the lock', () => {
    expect(loop).toMatch(/fixall-session\.ts acquire --pid \$\$ --harness claude-code --scheduled/)
  })

  it('and an interactive acquire is the one that publishes the pause', () => {
    const session = readFileSync(join(process.cwd(), 'scripts/fixall-session.ts'), 'utf8')
    expect(session).toMatch(/const scheduled = process\.argv\.includes\('--scheduled'\)/)
    expect(session).toMatch(/if \(!scheduled\) \{\s*registerHolder\(/)
    // Release must unregister whatever the lock says, or a stopped session
    // leaves the loops paused behind it.
    const release = session.slice(session.indexOf("if (command === 'release')"))
    expect(release.indexOf('unregisterHolder')).toBeLessThan(release.indexOf('releaseFixallSession'))
  })
})
