/**
 * "git could not be run" is not an answer from git (task cea0ddf5).
 *
 * A predeploy reported five failures — `check:docs` claiming
 * `docs/SCRIPT_INVENTORY.md` was stale, and four `script-inventory-sources`
 * tests — on a tree where all five pass. The machine was at load 348 on 8
 * cores with the other repo building, and `fork(2)` answers `EAGAIN` there, so
 * neither helper could spawn git.
 *
 * Both then treated that as information:
 *
 *   - `trackedPaths()` caught everything and returned `null`, which its own
 *     contract defines as "git unavailable, scan everything". So
 *     `scannableSources()` read all 2385 files — gitignored and untracked
 *     included — and `.claude/settings.local.json` was classified as a CALLER
 *     of the scripts it names. That is the exact machine-dependent inventory
 *     task 67b83f7e was written to make impossible.
 *   - `findGitIgnoredCodePaths()` guarded the spawn failure with
 *     `status === undefined`. Node sets `status` to **null**, never
 *     `undefined`, when the child never starts, so the guard missed and it
 *     threw `git check-ignore failed (exit null)`.
 *
 * A gate that goes red naming files that are fine teaches its readers to
 * dismiss red. These tests pin the distinction the helpers have to draw:
 * git answering, git genuinely absent, and git not getting to run.
 */
import { describe, it, expect, vi } from 'vitest'
import type { execFileSync } from 'node:child_process'

import { classifyGitError, runGit, GitUnrunnableError } from '@/scripts/lib/git-exec'
import { trackedPaths, scannableSources } from '@/scripts/lib/script-inventory'

/**
 * The spawn is injected rather than module-mocked: vitest externalises
 * `scripts/lib/`, so a `vi.mock('node:child_process')` is visible to this file
 * and NOT to the module under test — which passes the mock assertion and then
 * shells out to the real git. Injection is the seam that actually holds.
 */
type Exec = typeof execFileSync

/** Always fails to spawn, the way a fork-starved machine does. */
function alwaysUnspawnable(code: string): Exec {
  return vi.fn(() => {
    throw spawnFailure(code)
  }) as unknown as Exec
}

/** Always exits non-zero, the way git does when it has something to say. */
function alwaysExits(status: number, stderr = ''): Exec {
  return vi.fn(() => {
    throw exitedWith(status, stderr)
  }) as unknown as Exec
}

/** The shape Node produces when the child process never starts. */
function spawnFailure(code: string): Error {
  const error = new Error(`spawnSync git ${code}`) as Error & {
    status: number | null
    code: string
    errno: number
  }
  error.status = null
  error.code = code
  error.errno = code === 'EAGAIN' ? -35 : -12
  return error
}

/** The shape Node produces when git ran and exited non-zero. */
function exitedWith(status: number, stderr = ''): Error {
  const error = new Error('Command failed') as Error & { status: number; stderr: string }
  error.status = status
  error.stderr = stderr
  return error
}

describe('classifyGitError (task cea0ddf5)', () => {
  it.each(['EAGAIN', 'ENOMEM', 'EMFILE', 'ENFILE'])(
    'reads %s as the machine being too busy, not as an answer',
    code => {
      expect(classifyGitError(spawnFailure(code)).kind).toBe('transient')
    }
  )

  it('reads ENOENT as git genuinely not being installed', () => {
    expect(classifyGitError(spawnFailure('ENOENT')).kind).toBe('unavailable')
  })

  it.each([1, 128])('reads exit %i as git having answered', status => {
    const classified = classifyGitError(exitedWith(status))
    expect(classified.kind).toBe('answered')
    expect(classified.kind === 'answered' && classified.status).toBe(status)
  })

  it('never reports a null status as an exit code', () => {
    // The literal bug at doc-code-paths.ts:206: `exit null` in an error
    // message, from a `status === undefined` guard that null slips past.
    const classified = classifyGitError(spawnFailure('EAGAIN'))
    expect(classified.kind).not.toBe('answered')
    expect(JSON.stringify(classified)).not.toContain('null')
  })
})

describe('runGit retries a spawn the machine refused (task cea0ddf5)', () => {
  it('succeeds on a later attempt rather than failing the gate', () => {
    let calls = 0
    const exec = vi.fn(() => {
      calls += 1
      if (calls === 1) throw spawnFailure('EAGAIN')
      return 'package.json\0'
    }) as unknown as Exec

    const result = runGit('/repo', ['ls-files', '-z'], { exec, retryDelayMs: 0 })

    expect(result).toEqual({ ok: true, stdout: 'package.json\0' })
    expect(calls).toBe(2)
  })

  it('throws, naming contention, when it never gets to run', () => {
    const exec = alwaysUnspawnable('EAGAIN')

    expect(() =>
      runGit('/repo', ['ls-files', '-z'], { exec, attempts: 2, retryDelayMs: 0 })
    ).toThrow(GitUnrunnableError)
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('says plainly that contention, not the repository, is the problem', () => {
    // The message is the point: a reader who sees this must not go looking for
    // a stale doc or a broken test, which is what the old report caused.
    try {
      runGit('/repo', ['ls-files', '-z'], {
        exec: alwaysUnspawnable('EAGAIN'),
        attempts: 1,
        retryDelayMs: 0,
      })
      expect.unreachable('runGit should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('NOT a repository problem')
      expect((error as Error).message).toContain('EAGAIN')
    }
  })

  it('does not retry a real non-zero exit, which is an answer', () => {
    const exec = alwaysExits(1)

    expect(runGit('/repo', ['check-ignore', '--stdin'], { exec, retryDelayMs: 0 })).toEqual({
      ok: false,
      status: 1,
      stderr: '',
    })
    expect(exec).toHaveBeenCalledTimes(1)
  })
})

describe('the inventory refuses to answer without git (task cea0ddf5)', () => {
  it('throws instead of silently scanning every gitignored file', () => {
    // The regression: this returned null, so scannableSources() fell back to
    // "scan everything" and wrote a per-machine inventory into a committed doc.
    const options = { exec: alwaysUnspawnable('EAGAIN'), attempts: 2, retryDelayMs: 0 }

    expect(() => trackedPaths(process.cwd(), options)).toThrow(GitUnrunnableError)
    expect(() => scannableSources(process.cwd(), options)).toThrow(GitUnrunnableError)
  })

  it('still falls back to scanning everything when there is genuinely no repository', () => {
    // A tarball export with no .git is the case the null contract exists for,
    // and it must keep working — this is not "git failed", it is git answering.
    const exec = alwaysExits(128, 'fatal: not a git repository')

    expect(trackedPaths(process.cwd(), { exec, retryDelayMs: 0 })).toBeNull()
  })

  it('still falls back to scanning everything when git is not installed', () => {
    const exec = alwaysUnspawnable('ENOENT')

    expect(trackedPaths(process.cwd(), { exec, retryDelayMs: 0 })).toBeNull()
  })
})
