/**
 * AWTD-1301 — predeploy must see the production advisory audit.
 *
 * CI's `dependency-audit` job (`npm audit --audit-level=high --omit=dev`) went
 * red on main when vite 8.3.0–8.3.2 picked up a high launch-editor advisory,
 * and PR #461 merged straight past it. The gate every agent and the deploy
 * runner actually trust is `npm run predeploy`, and that did not run any audit,
 * so "16/16 green" said nothing about the advisories CI was reporting.
 *
 * `npm run audit:prod` (scripts/audit-production-advisories.ts, AWTD-914) asks
 * the same question as the CI job — critical/high in the shipping tree — and
 * exits 3 (UNKNOWN) when it cannot prove the answer, which a gate must treat
 * as red rather than clean. It is a network call, so it lives in predeploy
 * rather than in the unit suite: production-tree-has-no-known-rce.test.ts
 * keeps the offline half (floors already cleared never regress).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('predeploy runs the production advisory audit (AWTD-1301)', () => {
  it('has a gate that runs npm run audit:prod', () => {
    const source = read('scripts/predeploy-self-healing.ts')
    expect(
      source,
      'predeploy has no gate running `npm run audit:prod`, so a high advisory in the ' +
        'shipping tree can be green in predeploy while CI dependency-audit is red'
    ).toMatch(/command: 'npm run audit:prod'/)
  })

  it('keeps the audit script the gate depends on', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['audit:prod']).toBe('tsx scripts/audit-production-advisories.ts')
  })

  it('does not ship vite: it is a dev tool, and its advisories turned CI red', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.dependencies.vite).toBeUndefined()
    expect(pkg.devDependencies.vite).toBeDefined()
  })
})
