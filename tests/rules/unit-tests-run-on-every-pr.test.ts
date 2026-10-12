/**
 * AWTD-1216: a pull request must run the unit suite whatever it changes.
 *
 * `preview-deployment.yml` was the only pull_request workflow that ran vitest,
 * and it is path-filtered to the app's own directories — a preview only matters
 * when the app changed. `scripts/`, `tests/` and `.github/` are not on that
 * list, so a PR touching only those showed every check green without executing
 * a single unit test. PR #386 (AWTD-1207) carried a rule test that failed on
 * Linux that way; it was caught only because PR #387 happened to touch
 * package.json and so matched the filter. That is luck, not a gate.
 *
 * It left the rule tests in this directory — the ratchets on deploy triggers,
 * push behaviour and the scheduled loops — as the least-covered files in the
 * repo by CI, since a PR that edits or deletes one is exactly a tests-only PR.
 *
 * "Do the tests pass" is not a question about which directories changed, so
 * the suite has a workflow of its own and this holds it to having no filter.
 * Widening a `paths:` list instead would pass until the next new directory.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOWS = '.github/workflows'

/** `npm test`, `npm run test:run`, `npx vitest` — not `test:e2e` and friends. */
const RUNS_UNIT_SUITE = /\bnpm (?:run )?test(?::run)?(?![\w:-])|\bnpx vitest\b/

/** Keys that make a pull_request trigger skip some pull requests. */
const FILTERS = ['paths', 'paths-ignore', 'branches', 'branches-ignore']

/** What every PR needs covered: it opening, and each push to it afterwards. */
const NEEDED_TYPES = ['opened', 'synchronize', 'reopened']

/** The lines nested under the first line matching `header`, by indentation. */
function blockUnder(lines: string[], header: RegExp): string[] | undefined {
  const start = lines.findIndex(line => header.test(line))
  if (start === -1) return undefined
  const indent = lines[start].search(/\S/)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.trim() !== '' && line.search(/\S/) <= indent)
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * The pull_request trigger's own lines: `[]` when it is bare, `undefined` when
 * the workflow is not triggered by pull requests at all.
 */
function pullRequestTrigger(source: string): string[] | undefined {
  const lines = source.split('\n').filter(line => !/^\s*#/.test(line))
  // `on: pull_request` and `on: [push, pull_request]` carry no filters.
  if (lines.some(line => /^on:.*\bpull_request\b(?!_)/.test(line))) return []
  const on = blockUnder(lines, /^on:\s*$/)
  return on && blockUnder(on, /^\s+pull_request:\s*$/)
}

/** Why this workflow does not put the unit suite on every PR, or `null` if it does. */
function whyNotEveryPr(source: string): string | null {
  const trigger = pullRequestTrigger(source)
  if (!trigger) return 'not triggered by pull_request'

  const filter = FILTERS.find(key => trigger.some(line => line.trim().startsWith(`${key}:`)))
  if (filter) return `pull_request is filtered by "${filter}"`

  const types = trigger.find(line => line.trim().startsWith('types:'))
  const missing = types ? NEEDED_TYPES.filter(type => !types.includes(type)) : []
  if (missing.length > 0) return `pull_request types omit ${missing.join(', ')}`

  const runsSuite = source
    .split('\n')
    .some(line => /^\s*(?:- )?run:/.test(line) && RUNS_UNIT_SUITE.test(line))
  return runsSuite ? null : 'no step runs the unit suite'
}

describe('unit tests run on every pull request (AWTD-1216)', () => {
  it('has a pull_request workflow that runs the unit suite with no path or branch filter', () => {
    const verdicts = readdirSync(WORKFLOWS)
      .filter(file => /\.ya?ml$/.test(file))
      .map(file => ({ file, why: whyNotEveryPr(readFileSync(join(WORKFLOWS, file), 'utf8')) }))

    const covering = verdicts.filter(verdict => verdict.why === null).map(verdict => verdict.file)

    expect(
      covering,
      'No workflow runs the unit suite on every pull request:\n' +
        verdicts.map(verdict => `  ${verdict.file}: ${verdict.why}`).join('\n')
    ).not.toEqual([])
  })

  it('reads a filter, a narrowed type list and a bare trigger for what they are', () => {
    const run = '\njobs:\n  t:\n    steps:\n      - run: npm run test:run\n'

    expect(whyNotEveryPr(`on:\n  pull_request:\n  push:\n    branches: [main]${run}`)).toBeNull()
    expect(whyNotEveryPr(`on: [push, pull_request]${run}`)).toBeNull()
    expect(whyNotEveryPr(`on:\n  pull_request:\n    paths:\n      - 'app/**'${run}`)).toContain('paths')
    expect(whyNotEveryPr(`on:\n  pull_request:\n    branches: [main]${run}`)).toContain('branches')
    expect(whyNotEveryPr(`on:\n  pull_request:\n    types: [closed]${run}`)).toContain('synchronize')
    // A push filter is not a pull_request filter.
    expect(whyNotEveryPr(`on:\n  push:\n    branches: [main]${run}`)).toBe('not triggered by pull_request')
    expect(whyNotEveryPr('on:\n  pull_request:\njobs:\n  t:\n    steps:\n      - run: npm run test:e2e\n')).toBe(
      'no step runs the unit suite'
    )
  })

  it('tells the unit suite apart from the other test scripts', () => {
    for (const run of ['npm test', 'npm run test:run', 'npx vitest run', 'npm test -- --reporter=dot']) {
      expect(RUNS_UNIT_SUITE.test(run), run).toBe(true)
    }
    for (const run of ['npm run test:e2e', 'npm run test:risk-coverage', 'npm run test-setup', 'npx playwright test']) {
      expect(RUNS_UNIT_SUITE.test(run), run).toBe(false)
    }
  })
})
