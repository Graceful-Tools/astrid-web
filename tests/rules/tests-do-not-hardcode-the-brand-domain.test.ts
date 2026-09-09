/**
 * RATCHET — task f5022e72.
 *
 * 73 test files asserted `astrid.cc` as ground truth. That is exactly the trap
 * `docs/WHITELABELING.md` describes: only `tests/brands/brand-matrix.test.ts`
 * runs under a brand profile, so a partner build passes a suite that has our
 * domain baked into its expectations, and the suite reports nothing wrong right
 * up until their users see the wrong host.
 *
 * 56 files were converted to `BRAND.domain` / `BRAND.agentEmailDomain` in one
 * pass. This holds the remaining 28 and, more importantly, stops a 29th.
 *
 * A ratchet rather than a ban, because three groups genuinely cannot be
 * converted and one group is merely awkward:
 *
 *   - `brand-config`, `brand-security-boundaries` and `brand-matrix` test the
 *     brand system ITSELF. Parametrising them would assert
 *     `BRAND.domain === BRAND.domain`, which is true in every deployment and
 *     therefore says nothing. The lookalike-rejection cases in
 *     brand-security-boundaries (`evil-astrid.cc`, `notastrid.cc`,
 *     `www.astrid.cc.evil.test`) are the sharpest example: the literal IS the
 *     attack;
 *   - `tests/setup.ts` establishes the environment the others run in;
 *   - files that `vi.mock('@/lib/brand/config')` — importing BRAND there yields
 *     the mock, which has no `domain`, so the reference is undefined at
 *     runtime rather than at compile time;
 *   - files whose literal sits inside a `vi.mock` factory. Those are hoisted
 *     above the imports, so `BRAND` is not initialised when they run.
 *
 * The last two are solvable and worth solving; they are filed rather than
 * rushed. WHEN THIS FAILS because the count went UP, the fix is to use
 * `BRAND.domain` in the new file, not to raise the number.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const TESTS_DIR = join(ROOT, 'tests')

/** Files with a literal brand domain, as of 2026-09-09. Lower this, never raise it. */
const CEILING = 28

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) testFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** This rule names the literal in order to explain it. It is not an offender. */
const SELF = relative(ROOT, __filename)

const offenders = testFiles(TESTS_DIR)
  .map(file => relative(ROOT, file))
  .filter(file => file !== SELF)
  .filter(file => readFileSync(join(ROOT, file), 'utf8').includes('astrid.cc'))
  .sort()

describe('tests do not hardcode the brand domain (task f5022e72)', () => {
  it(`stays at or below ${CEILING} files carrying the literal`, () => {
    expect(
      offenders.length,
      offenders.length > CEILING
        ? `A test file hardcodes the brand domain. Use BRAND.domain (or ` +
          `BRAND.agentEmailDomain for an agent address) so a partner build ` +
          `asserts THEIR domain:\n` +
          offenders.map(f => `  ${f}`).join('\n')
        : `Down to ${offenders.length}. Lower CEILING in this file to lock the gain in.`
    ).toBeLessThanOrEqual(CEILING)
  })

  it('the ceiling is not left slack after a conversion lands', () => {
    // A ratchet allowed to drift above the real number has stopped ratcheting.
    // This fails when the count DROPS — the one failure here that is good news.
    expect(
      CEILING - offenders.length,
      `CEILING is ${CEILING} but only ${offenders.length} files carry the literal. ` +
        `Lower CEILING to ${offenders.length}.`
    ).toBeLessThanOrEqual(0)
  })
})
