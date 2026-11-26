/**
 * RATCHET — ADEV-296 (from the AWTD-1327 test audit).
 *
 * A "source pin" is a test that reads an app/components/lib source file with
 * readFileSync and asserts on its text, while never rendering a component and
 * never importing project code to call it. It pins spelling, not behaviour:
 * renaming a variable breaks it, and a regression that keeps the string passes.
 *
 * `tests/rules/` is exempt on purpose. Its repo-scanning rules are the one place
 * where reading source *is* the behaviour under test.
 *
 * Two failures, opposite meanings:
 *   - more pins than the budget → write a render test (tests/utils/test-providers.tsx
 *     mounts MainContent and TaskRow), a Playwright computed-style check, or a
 *     tests/rules/ rule instead. Do not raise the number.
 *   - fewer pins than the budget → good. Lower SOURCE_PIN_BUDGET to lock it in.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const TESTS = join(ROOT, 'tests')

/**
 * Pins left as of 2026-11-26, the day this ratchet was added, after 15 of the
 * audit's 34 were converted (rendered, or promoted into tests/rules/). Many of
 * the rest are script/workflow/config guards rather than UI pins, and each is
 * still a candidate. Lower it; never raise it.
 */
const SOURCE_PIN_BUDGET = 59

const RUNS_CODE = /\brender\(|renderHook\(|renderToStaticMarkup|renderWithProviders|from ['"]@\//

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

export function findSourcePins(): string[] {
  return walk(TESTS)
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.startsWith('tests/rules/'))
    .filter((f) => f !== 'tests/rules/source-pin-tests-ratchet.test.ts')
    .filter((f) => {
      const src = readFileSync(join(ROOT, f), 'utf8')
      return /readFileSync/.test(src) && !RUNS_CODE.test(src)
    })
    .sort()
}

describe('source-pin tests only fall (ADEV-296)', () => {
  it('has no more source pins than the budget', () => {
    const pins = findSourcePins()
    expect(pins.length, `source pins:\n${pins.join('\n')}`).toBeLessThanOrEqual(SOURCE_PIN_BUDGET)
  })

  it('has a budget that is not stale', () => {
    const pins = findSourcePins()
    expect(pins.length, `lower SOURCE_PIN_BUDGET to ${pins.length}`).toBe(SOURCE_PIN_BUDGET)
  })
})
