/**
 * The script inventory must not depend on whose machine generated it
 * (task 67b83f7e).
 *
 * `npm run check:docs` passed locally and failed in CI, which is where it
 * gated a production deploy. The scanner read every file under the repository
 * root, and `.claude/settings.local.json` — gitignored, per-machine, and a
 * `.json` file listing pre-approved commands — read as a CALLER of the scripts
 * it names. So `check-claude-agent-user.ts` and `test-claude-api.ts` were
 * "caller" on a developer machine and "unreferenced" in a clean checkout, and
 * the committed inventory recorded a state no clean checkout can reproduce.
 *
 * Regenerating the document would not have fixed it: it would flip back the
 * next time anyone regenerated it locally.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { relative } from 'node:path'
import {
  scannableSources,
  trackedPaths,
  activeScripts,
  buildInventory,
  inventoryProblems,
} from '@/scripts/lib/script-inventory'

const root = process.cwd()

/**
 * Batched, because asking git once per file took ~55s and a per-file
 * `check-ignore --quiet` also reported paths as ignored that a batched query
 * and `git ls-files | git check-ignore --stdin` both agree are not.
 */
function gitIgnoredAmong(relativePaths: string[]): string[] {
  if (relativePaths.length === 0) return []
  let stdout = ''
  try {
    stdout = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: root,
      input: relativePaths.join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
  } catch (error) {
    const status = (error as { status?: number }).status
    // 1 is check-ignore's normal "nothing matched".
    if (status === 1) return []
    const captured = (error as { stdout?: unknown }).stdout
    if (typeof captured !== 'string') throw error
    stdout = captured
  }
  return stdout.split('\n').filter(Boolean)
}

describe('script inventory sources (task 67b83f7e)', () => {
  it('scans no gitignored file, so the answer is the same in a clean checkout', () => {
    const scanned = scannableSources(root).map(path => relative(root, path))

    expect(gitIgnoredAmong(scanned)).toEqual([])
  })

  it('specifically does not read .claude/settings.local.json', () => {
    // The exact file that broke this: gitignored, per-machine, and a .json
    // listing pre-approved commands, so it read as a caller of every script it
    // names. Named explicitly so the regression is legible rather than implied.
    const scanned = scannableSources(root).map(path => relative(root, path))

    expect(scanned).not.toContain('.claude/settings.local.json')
  })

  it('scans no untracked file either', () => {
    const tracked = trackedPaths(root)
    expect(tracked, 'git must be answering for this test to mean anything').not.toBeNull()

    const untracked = scannableSources(root)
      .map(path => relative(root, path))
      .filter(path => !tracked!.has(path))

    expect(untracked).toEqual([])
  })

  it('classifies only committed scripts, so a scratch file cannot enter the inventory', () => {
    const tracked = trackedPaths(root)!
    const uncommitted = activeScripts(root).filter(name => !tracked.has(`scripts/${name}`))

    expect(uncommitted).toEqual([])
  })

  it('agrees with the committed docs/SCRIPT_INVENTORY.md', () => {
    // The check `npm run check:docs` runs, asserted here so a mismatch surfaces
    // in the unit suite rather than ten minutes into a deploy.
    expect(inventoryProblems(root, buildInventory(root))).toEqual([])
  })
})
