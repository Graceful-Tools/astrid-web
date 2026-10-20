/**
 * AWTD-1280 — production-deployment.yml asked https://astrid.cc whether the
 * deploy landed, so a partner running the workflow on their own repository
 * health-checked Astrid instead of themselves, and passed or failed on
 * Astrid's state.
 *
 * The URL comes from the `PRODUCTION_URL` repository variable, defaulting to
 * https://astrid.cc so hosted Astrid behaves exactly as before. This is a
 * workflow-shape ratchet: it cannot run Actions, so it pins the one place the
 * URL is decided and that no step goes around it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const WORKFLOW = '.github/workflows/production-deployment.yml'
const source = readFileSync(WORKFLOW, 'utf8')

describe(`${WORKFLOW} production URL (AWTD-1280)`, () => {
  it('decides it once, from vars.PRODUCTION_URL, defaulting to https://astrid.cc', () => {
    expect(source).toMatch(
      /^env:\n(?: {2}.*\n)*? {2}PRODUCTION_URL: \$\{\{ vars\.PRODUCTION_URL \|\| 'https:\/\/astrid\.cc' \}\}\n/m,
    )
  })

  it('never hardcodes the production origin in a step', () => {
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => !line.trim().startsWith('#'))
      .filter(({ line }) => /https:\/\/astrid\.cc/.test(line))
      .filter(({ line }) => !/^\s*PRODUCTION_URL:/.test(line))
    expect(offenders.map(o => `${WORKFLOW}:${o.n}: ${o.line.trim()}`)).toEqual([])
  })

  it('verifies the deployed SHA against the same URL, not the script’s own default', () => {
    const calls = source
      .split('\n')
      .filter(line => !line.trim().startsWith('#') && /bash scripts\/verify-deployed-sha\.sh/.test(line))
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call).toMatch(/--url "\$PRODUCTION_URL"/)
  })
})
