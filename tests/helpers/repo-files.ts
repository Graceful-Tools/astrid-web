/**
 * One cached repo walk per worker (ADEV-295).
 *
 * Repo-scanning rule tests each re-walked the tree with readdirSync/statSync.
 * Vitest isolates modules per test file, so the cache lives on globalThis to
 * survive across files that share a worker.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_KEY = Symbol.for('astrid.tests.repo-files')

type Cache = Map<string, string[]>

function cache(): Cache {
  const g = globalThis as Record<symbol, Cache | undefined>
  return (g[CACHE_KEY] ??= new Map())
}

/** Absolute paths of every file under `dir` matching `pattern`, skipping node_modules, dist and dot-directories. */
export function repoFiles(dir: string, pattern: RegExp): string[] {
  const key = `${dir}\0${pattern.source}\0${pattern.flags}`
  const hit = cache().get(key)
  if (hit) return hit
  const out: string[] = []
  const walk = (current: string) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (pattern.test(entry.name)) out.push(full)
    }
  }
  walk(dir)
  cache().set(key, out)
  return out
}
