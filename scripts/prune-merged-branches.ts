#!/usr/bin/env tsx
/**
 * Delete remote branches that are already merged into origin/main.
 *
 * Usage: npm run branches:prune -- [--repo <path>] [--dry-run]
 *   --repo     a git checkout of the repo to prune (default: this one). Works for any
 *              Graceful-Tools repo whose default branch is main, e.g. ../astrid-core.
 *   --dry-run  list what would be deleted, delete nothing.
 *
 * A branch is deleted only when its tip is an ancestor of origin/main AND either a
 * merged PR had it as head, or its tip commit is older than 7 days. The second
 * condition keeps a peer's freshly created, still-empty branch (which is trivially
 * "merged") alive. main, prod, and branches with an open PR are never touched.
 *
 * Jon, 2026-11-13: deleting merged branches on GitHub is part of the workflow.
 */

import { execFileSync } from 'child_process'
import { resolve } from 'path'

const KEEP = new Set(['main', 'prod', 'HEAD'])
const STALE_MS = 7 * 24 * 60 * 60 * 1000

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const repoIdx = args.indexOf('--repo')
const repo = resolve(repoIdx >= 0 && args[repoIdx + 1] ? args[repoIdx + 1] : process.cwd())

function git(...a: string[]): string {
  return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function gh(...a: string[]): string {
  return execFileSync('gh', a, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function prHeads(state: 'merged' | 'open'): Set<string> {
  const out = gh('pr', 'list', '--state', state, '--limit', '5000', '--json', 'headRefName', '--jq', '.[].headRefName')
  return new Set(out.split('\n').filter(Boolean))
}

git('fetch', '--prune', '--quiet', 'origin')
const merged = git('branch', '-r', '--merged', 'origin/main', '--format=%(refname:short)')
  .split('\n')
  .map(r => r.trim().replace(/^origin\//, ''))
  .filter(b => b && b !== 'origin' && !KEEP.has(b))

const mergedPrHeads = prHeads('merged')
const openPrHeads = prHeads('open')
const now = Date.now()

const doomed = merged.filter(branch => {
  if (openPrHeads.has(branch)) return false
  if (mergedPrHeads.has(branch)) return true
  const tipMs = Number(git('log', '-1', '--format=%ct', `origin/${branch}`).trim()) * 1000
  return now - tipMs > STALE_MS
})
const kept = merged.length - doomed.length

console.log(`${repo}: ${merged.length} merged remote branches, ${doomed.length} to delete, ${kept} kept (fresh or open PR)`)
if (dryRun) {
  for (const b of doomed) console.log(`  would delete ${b}`)
  process.exit(0)
}

let failed = 0
for (let i = 0; i < doomed.length; i += 50) {
  const batch = doomed.slice(i, i + 50)
  try {
    git('push', '--quiet', 'origin', '--delete', ...batch)
  } catch {
    // One bad ref fails the batch; retry one by one so the rest still go.
    for (const b of batch) {
      try {
        git('push', '--quiet', 'origin', '--delete', b)
      } catch {
        failed++
        console.error(`  could not delete ${b}`)
      }
    }
  }
}
console.log(`Deleted ${doomed.length - failed} branches${failed ? `, ${failed} failed` : ''}.`)
process.exit(failed ? 1 : 0)
