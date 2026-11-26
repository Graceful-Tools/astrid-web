#!/usr/bin/env node
/**
 * Fail CI when a Playwright test passed only on retry (ADEV-298).
 *
 * Retries turn a flake into a green run, so a flaky test stayed invisible for months.
 * This reads the JSON report and fails on any `flaky` test that is not in
 * KNOWN_FLAKY, a list that may only shrink. Pass --warn to emit a `::warning`
 * without failing.
 *
 * Usage: node scripts/check-playwright-flaky.mjs [report.json]
 */
import { existsSync, readFileSync } from 'node:fs'

/** Titles allowed to be flaky during the transition. Never add to this list. */
export const KNOWN_FLAKY = []

export function collectFlaky(report) {
  const flaky = []
  const walk = (suite, trail) => {
    for (const child of suite.suites ?? []) walk(child, [...trail, child.title])
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status === 'flaky') {
          flaky.push({ title: spec.title, file: spec.file ?? trail[0], project: test.projectName })
        }
      }
    }
  }
  for (const suite of report.suites ?? []) walk(suite, [suite.title])
  return flaky
}

export function unexpectedFlaky(flaky, known = KNOWN_FLAKY) {
  return flaky.filter((f) => !known.includes(f.title))
}

function main() {
  const path = process.argv.slice(2).find((a) => !a.startsWith('--')) ??'playwright-results.json'
  if (!existsSync(path)) {
    console.log(`No Playwright JSON report at ${path}; nothing to check.`)
    return 0
  }
  const flaky = unexpectedFlaky(collectFlaky(JSON.parse(readFileSync(path, 'utf8'))))
  if (flaky.length === 0) {
    console.log('No flaky Playwright tests.')
    return 0
  }
  const lines = flaky.map((f) => `- ${f.file} [${f.project}]: ${f.title}`)
  const warnOnly = process.argv.includes('--warn')
  const level = warnOnly ? 'warning' : 'error'
  console.log(`::${level}::${flaky.length} flaky Playwright test(s) passed only on retry`)
  console.log(lines.join('\n'))
  return warnOnly ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main())
