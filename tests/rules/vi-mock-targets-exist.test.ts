/**
 * RULE — AWTD-1340.
 *
 * `vi.mock('@/some/module', ...)` for a module that does not exist is silently
 * accepted by vitest: the factory is registered, nothing ever imports it, and
 * the test keeps passing. The mock line then reads as "this test is isolated
 * from X" when X was renamed or deleted long ago — the real dependency (or its
 * replacement) runs unmocked, and the test's claim of isolation is false.
 *
 * This rule scans every test file for `vi.mock('@/…')` and fails when the
 * target does not resolve to a file on disk.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const TESTS_DIR = join(ROOT, 'tests')
// This file quotes the pattern in its own comments; don't scan it.
const SELF = join(TESTS_DIR, 'rules', 'vi-mock-targets-exist.test.ts')

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']
const MOCK_RE = /vi\.(?:mock|doMock)\(\s*(['"])@\/([^'"]+)\1/g

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && full !== SELF) out.push(full)
  }
  return out
}

/** Resolve an `@/x` specifier the way the bundler would (tsconfig `@/*` → `./*`). */
function resolvesToFile(specifier: string, root = ROOT): boolean {
  const base = join(root, specifier)
  if (existsSync(base) && statSync(base).isFile()) return true
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return true
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(join(base, 'index' + ext))) return true
  }
  return false
}

function staleMocks(): string[] {
  const stale: string[] = []
  for (const file of walk(TESTS_DIR)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(MOCK_RE)) {
      const target = match[2]
      if (!resolvesToFile(target)) {
        const line = source.slice(0, match.index).split('\n').length
        stale.push(`${relative(ROOT, file)}:${line} → @/${target}`)
      }
    }
  }
  return stale
}

describe('vi.mock targets exist (AWTD-1340)', () => {
  it('finds vi.mock calls to check (the scan is not vacuous)', () => {
    const count = walk(TESTS_DIR).reduce(
      (n, f) => n + [...readFileSync(f, 'utf8').matchAll(MOCK_RE)].length,
      0,
    )
    expect(count).toBeGreaterThan(50)
  })

  it('resolves real modules and rejects missing ones', () => {
    expect(resolvesToFile('lib/list-permissions')).toBe(true)
    expect(resolvesToFile('lib/definitely-not-a-module-awtd-1340')).toBe(false)
  })

  it('every vi.mock("@/…") target resolves to a file', () => {
    expect(staleMocks()).toEqual([])
  })
})
