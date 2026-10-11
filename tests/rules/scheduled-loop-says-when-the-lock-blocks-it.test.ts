/**
 * A loop muted by the working-tree lock must say so (AWTD-1207).
 *
 * WHAT WENT WRONG. On 2026-10-09 a live interactive session (pid 15247) held
 * this checkout from 15:25Z onward. Guard 1 correctly refused every tick — 31
 * of them, plus 30 more the next day — and the loop worked ONE task in 48
 * ticks. Nothing was posted to the board the whole time: guard 1 echoed
 * `RESULT: SKIPPED` and exited without touching STUCK_FILE, so
 * the tracker's alert (then named skip_guard2) could never fire for it. The
 * loop has was the one class it never reported, and the only reason anyone
 * found out was that the queue felt slow two days later.
 *
 * DEFERRING TO A LIVE SESSION IS STILL RIGHT. The fix is not a lock that
 * expires — scripts/lib/fixall-session-lock.ts decides staleness by liveness
 * on purpose, and an age cap would have moved HEAD under a session that was
 * genuinely working. The fix is that a long hold is announced.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const block = loop.slice(
  loop.indexOf('# ── A skip that never ends is an outage'),
  loop.indexOf('release_lock()'),
)

let dir: string
let bin: string
let stuckFile: string

function tsxExits(code: number): void {
  const path = join(bin, 'tsx')
  writeFileSync(path, `#!/bin/bash\nexit ${code}\n`, 'utf8')
  chmodSync(path, 0o755)
}

function run(env: Record<string, string> = {}): string {
  const script = `post_to_list() { echo "POSTED: $1"; }\n${block}\necho "FELL THROUGH"`
  return execFileSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: dir,
      TSX: join(bin, 'tsx'),
      REPO: dir,
      ...env,
    },
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixall-lock-alert-'))
  bin = join(dir, 'bin')
  mkdirSync(bin)
  stuckFile = join(dir, 'Library/Caches/astrid-fixall/stuck-web')
  tsxExits(2) // 2 = another live session holds this tree
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the scheduled loop says when the lock blocks it', () => {
  it('starts the clock on the first tick the lock refuses', () => {
    const out = run()
    expect(out).toContain('RESULT: SKIPPED')
    expect(out).toContain('another live session holds this checkout')
    expect(out).not.toContain('FELL THROUGH')
    expect(existsSync(stuckFile)).toBe(true)
    expect(out).not.toContain('POSTED:') // one tick is not an outage
  })

  it('posts to the board once the hold passes the alert threshold', () => {
    mkdirSync(join(dir, 'Library/Caches/astrid-fixall'), { recursive: true })
    const threeHoursAgo = Math.floor(Date.now() / 1000) - 3 * 60 * 60
    writeFileSync(stuckFile, `${threeHoursAgo}\n`, 'utf8')

    const out = run()
    expect(out).toContain('POSTED:')
    expect(out).toMatch(/18\d minutes|180 minutes/)
    expect(out).toContain('another live session holds this checkout')
    expect(readFileSync(stuckFile, 'utf8')).toContain('alerted')
  })

  it('does not post a second time for the same hold', () => {
    mkdirSync(join(dir, 'Library/Caches/astrid-fixall'), { recursive: true })
    const threeHoursAgo = Math.floor(Date.now() / 1000) - 3 * 60 * 60
    writeFileSync(stuckFile, `${threeHoursAgo}\nalerted\n`, 'utf8')
    expect(run()).not.toContain('POSTED:')
  })

  it('gets out of the way when the lock is free', () => {
    tsxExits(0)
    const out = run()
    expect(out).toContain('FELL THROUGH')
    expect(out).not.toContain('RESULT: SKIPPED')
  })

  it('fails loudly on a lock error, which is not a skip', () => {
    tsxExits(1)
    let out = ''
    try {
      out = run()
    } catch (error) {
      out = (error as { stdout: string }).stdout
    }
    expect(out).toContain('RESULT: FAILED')
  })
})
