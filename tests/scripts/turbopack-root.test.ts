/**
 * RED for AWTD-1240.
 *
 * Every `/fixall` worktree gets its dependencies as a symlink —
 * `www-task-awtd-1212/node_modules -> /Users/jonparis/mycode/astrid-web/node_modules`
 * — and Turbopack refuses that outright:
 *
 *   Error [TurbopackInternalError]: Symlink [project]/node_modules is invalid,
 *   it points out of the filesystem root
 *
 * It fails in ~2 seconds, before compiling anything, so predeploy's Build gate
 * could not pass in ANY worktree, for any branch. The workflow's own definition
 * of done ("committed on its branch with `npm run predeploy` green") and its
 * rule of one isolated worktree per task could not both be satisfied — and the
 * dangerous resolution was the quiet one, where an agent drops the Build check
 * and a real build break reaches `main` behind a green-looking report.
 *
 * `turbopackRoot` decides the one thing that fixes it: name a filesystem root
 * that contains BOTH the worktree and the real `node_modules`. The cases that
 * matter are the ones where it must decide NOT to:
 *
 *   - a normal checkout, CI and Vercel, where `node_modules` is a real
 *     directory. Setting a root there would change how every production build
 *     resolves and traces files in exchange for nothing;
 *   - a common ancestor of `/`, where a root would hand Turbopack the whole
 *     filesystem. An honest failure is better than that.
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { turbopackRoot, commonAncestor } from '@/scripts/lib/turbopack-root.mjs'

const WORKTREE = '/Users/jonparis/mycode/www-task-awtd-1240'
const CHECKOUT = '/Users/jonparis/mycode/astrid-web'

describe('turbopackRoot (AWTD-1240)', () => {
  it('names an ancestor of both trees when node_modules is linked out of the worktree', () => {
    const root = turbopackRoot(WORKTREE, {
      linked: true,
      realPath: `${CHECKOUT}/node_modules`,
    })

    expect(root).toBe('/Users/jonparis/mycode')
  })

  it('sets no root at all in a normal checkout, so a production build is untouched', () => {
    // This is the case that runs on Vercel and in CI. `undefined` means the
    // config omits `turbopack.root` entirely and Next keeps inferring it.
    expect(turbopackRoot(CHECKOUT, { linked: false })).toBeUndefined()
  })

  it('sets no root when the link stays inside the project', () => {
    // Nothing to widen: Turbopack can already resolve it.
    expect(
      turbopackRoot(WORKTREE, { linked: true, realPath: `${WORKTREE}/vendor/node_modules` })
    ).toBeUndefined()
  })

  it('refuses a root of / rather than handing Turbopack the filesystem', () => {
    expect(turbopackRoot('/srv/worktree', { linked: true, realPath: '/opt/deps/node_modules' }))
      .toBeUndefined()
  })

  it('reads the filesystem itself when no facts are injected', () => {
    // The call site in next.config.mjs passes one argument, so the default has
    // to do the lstat. Built on disk rather than asserted about this checkout,
    // which is a worktree exactly when the bug is present — a test that read
    // process.cwd() would answer differently depending on where the suite ran.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'awtd-1240-')))
    const project = join(root, 'worktree')
    const deps = join(root, 'checkout', 'node_modules')
    mkdirSync(project)
    mkdirSync(deps, { recursive: true })
    symlinkSync(deps, join(project, 'node_modules'))

    expect(turbopackRoot(project)).toBe(root)

    const ordinary = join(root, 'ordinary')
    mkdirSync(join(ordinary, 'node_modules'), { recursive: true })
    expect(turbopackRoot(ordinary)).toBeUndefined()

    rmSync(root, { recursive: true, force: true })
  })

  it('sets no root when there is no node_modules to judge', () => {
    // A missing node_modules is the build's own problem to report. Inventing a
    // root here would only change which error it fails with.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'awtd-1240-')))

    expect(turbopackRoot(root)).toBeUndefined()

    rmSync(root, { recursive: true, force: true })
  })
})

describe('commonAncestor (AWTD-1240)', () => {
  it('stops at the last shared segment', () => {
    expect(commonAncestor('/a/b/c/d', '/a/b/e')).toBe('/a/b')
  })

  it('does not treat a shared PREFIX as a shared directory', () => {
    // /a/bbb is not inside /a/bb, and a string prefix check would say it is.
    expect(commonAncestor('/a/bb/x', '/a/bbb/y')).toBe('/a')
  })

  it('returns the root when nothing but / is shared', () => {
    expect(commonAncestor('/srv/one', '/opt/two')).toBe('/')
  })

  it('returns the directory itself when one contains the other', () => {
    expect(commonAncestor('/a/b', '/a/b/c')).toBe('/a/b')
  })
})
