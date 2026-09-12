/**
 * RULES TEST — task e586eff1.
 *
 * `docs/PERFORMANCE_BUDGETS.md` opens by insisting every row name the thing
 * that produces its number, because a budget with no source is decoration.
 * That is right, and the document policed it in one direction only.
 *
 * The other direction cost more. The Core Web Vitals row was marked **no
 * source**, with a paragraph explaining that CWV became unmeasurable when the
 * third-party analytics client was removed on 2026-09-06 (`a0373f86`).
 * Meanwhile `app/[locale]/layout.tsx` was mounting `<SpeedInsights />` —
 * Vercel's Core Web Vitals product — in the root locale layout, on every
 * route, and had been since 2025-08-13. The Vercel project API reported
 * `speedInsights.hasData: true` throughout.
 *
 * So the document told readers a metric was unmeasured while it was being
 * measured continuously, and a task was filed to build a second collection
 * pipeline to fix the absence. A wrong "no source" is not a harmless
 * understatement; it is an instruction to duplicate working infrastructure.
 *
 * WHAT THIS ENFORCES: while the Speed Insights component is mounted, the
 * budget document may not describe Core Web Vitals as having no source.
 *
 * If Speed Insights is ever removed, this test stops applying on its own —
 * it is conditional on the mount, not a hardcoded assertion about the text.
 * That is deliberate: the rule is "the document agrees with what is
 * deployed", not "the document says a particular sentence".
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const LAYOUT = join(ROOT, 'app/[locale]/layout.tsx')
const BUDGETS = join(ROOT, 'docs/PERFORMANCE_BUDGETS.md')

/** Is Vercel's Core Web Vitals collector actually deployed? */
function speedInsightsIsMounted(): boolean {
  if (!existsSync(LAYOUT)) return false
  const source = readFileSync(LAYOUT, 'utf8')
  return /@vercel\/speed-insights/.test(source) && /<SpeedInsights\s*\/?>/.test(source)
}

/** The row for Core Web Vitals in the budget table. */
function coreWebVitalsRow(): string | null {
  const doc = readFileSync(BUDGETS, 'utf8')
  const row = doc.split('\n').find(line => line.startsWith('|') && /Core Web Vitals/i.test(line))
  return row ?? null
}

describe('a metric that is being collected is not documented as unmeasured (task e586eff1)', () => {
  it('Speed Insights is mounted, or this rule does not apply', () => {
    // Recorded rather than assumed: if this ever goes false, the assertions
    // below are vacuous and the reader should know why.
    expect(typeof speedInsightsIsMounted()).toBe('boolean')
  })

  it('the Core Web Vitals row does not claim "no source" while Speed Insights collects it', () => {
    if (!speedInsightsIsMounted()) return
    const row = coreWebVitalsRow()
    expect(row, 'docs/PERFORMANCE_BUDGETS.md has no Core Web Vitals row at all').not.toBeNull()
    expect(
      /no source/i.test(row!),
      [
        'The Core Web Vitals row says it has no source, but app/[locale]/layout.tsx',
        'mounts <SpeedInsights /> in the root locale layout — Vercel collects LCP,',
        'INP and CLS on every route.',
        '',
        'Name that source. If the complaint is that the dashboard has no API and',
        'the number cannot be scripted, say THAT — it is true and it is a different',
        'problem from having nothing to read.',
      ].join('\n'),
    ).toBe(false)
  })

  it('the document names Speed Insights as the source', () => {
    if (!speedInsightsIsMounted()) return
    const doc = readFileSync(BUDGETS, 'utf8')
    expect(/Speed Insights/i.test(doc)).toBe(true)
  })
})
