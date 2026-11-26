/**
 * Fail the job when Playwright reports a flaky test (ADEV-298).
 *
 * A test that fails and then passes on retry leaves the run green, so flakes
 * piled up unseen (nearly every browser job reported "1 flaky"). This reads the
 * JSON report, annotates each flaky test, writes a job summary, and exits 1
 * unless every flaky title is on the known-flaky list. That list may only shrink.
 *
 * Usage: tsx scripts/check-playwright-flaky.ts [report.json]
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

export const DEFAULT_REPORT = 'test-results/report.json'

/** Titles allowed to flake during the transition. Shrink-only: never add to it. */
export const KNOWN_FLAKY: readonly string[] = []

interface Suite {
  title?: string
  file?: string
  suites?: Suite[]
  specs?: Array<{
    title: string
    file?: string
    tests?: Array<{ projectName?: string; status?: string }>
  }>
}

export interface FlakyTest {
  file: string
  title: string
  project: string
}

export function findFlaky(report: { suites?: Suite[] }): FlakyTest[] {
  const found: FlakyTest[] = []
  const walk = (suite: Suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status === 'flaky') {
          found.push({ file: spec.file ?? suite.file ?? '', title: spec.title, project: test.projectName ?? '' })
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)
  return found
}

export function unexpectedFlaky(flaky: FlakyTest[], known: readonly string[] = KNOWN_FLAKY): FlakyTest[] {
  return flaky.filter(test => !known.includes(test.title))
}

function main() {
  const path = process.argv[2] ?? DEFAULT_REPORT
  if (!existsSync(path)) {
    console.log(`No Playwright JSON report at ${path}; nothing to check.`)
    return 0
  }
  const flaky = findFlaky(JSON.parse(readFileSync(path, 'utf8')))
  if (flaky.length === 0) {
    console.log('No flaky tests.')
    return 0
  }
  for (const test of flaky) {
    console.log(`::warning file=${test.file}::Flaky test (failed, then passed on retry) [${test.project}]: ${test.title}`)
  }
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const rows = flaky.map(test => `| ${test.project} | \`${test.file}\` | ${test.title} |`)
    appendFileSync(summary, ['### Flaky Playwright tests', '', '| Project | File | Test |', '|---|---|---|', ...rows, ''].join('\n'))
  }
  const unexpected = unexpectedFlaky(flaky)
  if (unexpected.length > 0) {
    console.error(`${unexpected.length} flaky test(s) are not on the known-flaky list. Fix the race; do not add to the list.`)
    return 1
  }
  return 0
}

if (process.argv[1]?.endsWith('check-playwright-flaky.ts')) process.exit(main())
