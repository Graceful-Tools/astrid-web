/**
 * RULE — every Playwright spec runs somewhere, or says why not (AWTD-1338).
 *
 * Every project in playwright.config.ts has a `testMatch` allow-list. Until
 * 2026-10-22, 24 of 31 spec files matched none of them — about 176 tests that
 * had never run since the initial release, including board drag, list
 * settings and every mobile-shell regression spec. Nothing noticed, because a
 * spec no project collects is not a failure; it is simply absent.
 *
 * So: each `e2e/*.spec.ts` is matched by some project's `testMatch` (with the
 * signed-in projects switched on), or is listed in PENDING_E2E_SPECS with a
 * reason. The pending list may only shrink — an entry for a spec that no
 * longer exists, or that already runs, fails here too.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readdirSync } from 'fs'
import { join } from 'path'

const E2E = join(__dirname, '..', '..', 'e2e')

type Project = { name?: string; testMatch?: RegExp | string | Array<RegExp | string> }

let projects: Project[] = []
let pending: Record<string, string> = {}

beforeAll(async () => {
  process.env.PLAYWRIGHT_AUTHENTICATED = '1'
  const config = await import('@/playwright.config')
  projects = (config.default as { projects?: Project[] }).projects ?? []
  pending = config.PENDING_E2E_SPECS
})

const specs = readdirSync(E2E).filter(name => name.endsWith('.spec.ts')).map(name => name.replace(/\.spec\.ts$/, ''))

function runsIn(spec: string): string[] {
  const path = join(E2E, `${spec}.spec.ts`)
  return projects
    .filter(project => {
      const patterns = [project.testMatch].flat().filter(Boolean) as Array<RegExp | string>
      return patterns.some(pattern => (typeof pattern === 'string' ? path.endsWith(pattern) : pattern.test(path)))
    })
    .map(project => project.name ?? '?')
}

describe('every e2e spec runs somewhere (AWTD-1338)', () => {
  it('finds the specs and the projects', () => {
    expect(specs.length).toBeGreaterThan(5)
    expect(projects.map(p => p.name)).toContain('authenticated-ui')
  })

  it('matches every spec to a project, or lists it as pending with a reason', () => {
    const orphans = specs.filter(spec => runsIn(spec).length === 0 && !pending[spec])
    expect(orphans, 'These specs run in no Playwright project. Add them to a project\'s testMatch (playwright.config.ts), or to PENDING_E2E_SPECS with why').toEqual([])
  })

  it('keeps the pending list honest: no entry for a spec that is gone or already runs', () => {
    const stale = Object.keys(pending).filter(spec => !specs.includes(spec) || runsIn(spec).length > 0)
    expect(stale, 'Remove these from PENDING_E2E_SPECS').toEqual([])
  })
})
