/**
 * Which checkouts a Doing release searches for the task's branch, and what is in them (AWTD-1510).
 *
 * `release-stuck-doing.ts --repo <path>` used to read that one repo's branches. The
 * Windows board's [core] work lives in the sibling astrid-core checkout, so a release run
 * by the Windows loop (`--repo <astrid-windows>`) said a core task "starts fresh" while its
 * branch sat in astrid-core. Now every checkout the board can touch is searched
 * (BOARD_CHECKOUTS), the board taken from `--board` or from the loop's own repo.
 *
 * Separate from release-stuck-doing.ts because that script calls main() at import.
 */
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import type { ReadyQueueBoard } from '@/lib/ready-queue-scope'
import { BOARD_CHECKOUTS, boardForRepo } from './board-by-name'
import type { CheckoutBranches } from './doing-release'

export interface Checkout {
  name: string
  path: string
}

function gitIn(repo: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30_000,
  })
}

/** The repo a checkout is a clone of — origin's last path segment — else its folder name. */
export function checkoutName(repo: string): string {
  try {
    const url = gitIn(repo, ['remote', 'get-url', 'origin']).trim()
    const name = url.replace(/[/\\]+$/, '').split(/[/:\\]/).pop()?.replace(/\.git$/, '')
    if (name) return name
  } catch {
    // Not a checkout, or no origin: the folder is the best name there is.
  }
  return basename(resolve(repo))
}

function isCheckout(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    gitIn(path, ['rev-parse', '--git-dir'])
    return true
  } catch {
    return false
  }
}

/**
 * The checkouts to search: every `--repo` given, then the board's other checkouts found
 * beside the first one. Each repo is searched once, by name.
 */
export function releaseCheckouts(input: { repos: string[]; board?: ReadyQueueBoard | null }): Checkout[] {
  const checkouts: Checkout[] = []
  const add = (path: string) => {
    const name = checkoutName(path)
    if (!checkouts.some(c => c.name === name)) checkouts.push({ name, path })
  }
  for (const repo of input.repos) add(resolve(repo))
  const primary = checkouts[0]
  if (!primary) return checkouts
  const board = input.board ?? boardForRepo(primary.name)
  if (!board) return checkouts
  for (const sibling of BOARD_CHECKOUTS[board]) {
    if (checkouts.some(c => c.name === sibling)) continue
    const path = join(dirname(primary.path), sibling)
    if (isCheckout(path)) add(path)
  }
  return checkouts
}

/** Remote branch names (`fix/x`), from `git ls-remote origin`. Empty on any git error. */
export function remoteBranches(repo: string): string[] {
  try {
    return gitIn(repo, ['ls-remote', '--heads', 'origin'])
      .split('\n')
      .map(line => line.split('refs/heads/')[1]?.trim())
      .filter((name): name is string => Boolean(name))
  } catch {
    return []
  }
}

/**
 * Remote branches already merged into origin/main, as `ls-remote` names them
 * (`fix/x`, not `origin/fix/x`). Read from the repo's remote-tracking refs, so a
 * branch it has never fetched is simply not excluded. Empty on any git error.
 */
export function mergedRemoteBranches(repo: string): string[] {
  try {
    return gitIn(repo, ['branch', '-r', '--merged', 'origin/main', '--format=%(refname:short)'])
      .split('\n')
      .map(line => line.trim())
      .filter(name => name.startsWith('origin/') && name !== 'origin/main' && name !== 'origin/HEAD')
      .map(name => name.slice('origin/'.length))
  } catch {
    return []
  }
}

export function readCheckout(checkout: Checkout): CheckoutBranches {
  return { name: checkout.name, branches: remoteBranches(checkout.path), merged: mergedRemoteBranches(checkout.path) }
}
