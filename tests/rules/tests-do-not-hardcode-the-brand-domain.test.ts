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

/**
 * Files with a literal brand domain in their ASSERTIONS. Lower this, never raise it.
 *
 * 28 -> 3 (AWTD-867). Two different things brought it down, and they are worth
 * telling apart:
 *
 *   - 13 files were genuinely converted to BRAND.domain / BRAND.agentEmailDomain,
 *     working through the three shapes that made them awkward: a literal inside a
 *     hoisted `vi.mock` factory (fixed with `await vi.hoisted(async () => import(...))`,
 *     at MODULE scope, since `await` is only legal at a module's top level); a file
 *     that mocks @/lib/brand/config itself, where an ordinary import yields the mock
 *     and `vi.importActual` is needed to reach past it; and one assertion carrying
 *     the domain inside a REGEX LITERAL, where `${BRAND.domain}` does not interpolate
 *     and would have become a literal `${...}` that silently never matched.
 *
 *   - 12 more were never offenders. Their only mention of the domain was prose in a
 *     jsdoc block recording a real incident, and the check above now skips comment
 *     lines. Rewording accurate evidence to satisfy a substring search would have
 *     made the suite worse, not more portable.
 *
 * The three that remain are the floor, and they are correct as they are:
 * brand-config and brand-security-boundaries test the brand system ITSELF, where
 * parametrising would assert BRAND.domain === BRAND.domain and prove nothing — and
 * in the lookalike cases (`evil-astrid.cc`, `www.astrid.cc.evil.test`) the literal
 * IS the attack. tests/setup.ts establishes the environment the rest run in.
 *
 * One note for whoever revisits that floor: the lookalike argument is weaker than
 * it looks. AWTD-867 converted the same shape in authenticated-not-authorized.test.ts
 * to `evil-${BRAND.domain}`, on the grounds that a partner build must reject a
 * lookalike of THEIR domain — ours would sail past their prefix check and the test
 * would pass while proving nothing. brand-security-boundaries was left alone because
 * the filing said to, not because the argument does not apply.
 */
const CEILING = 3

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

/**
 * Is this line a comment, and therefore prose rather than an assertion?
 *
 * The check used to be `readFileSync(...).includes('astrid.cc')` over the whole
 * file, which counted twelve files whose only mention of the domain was a jsdoc
 * block documenting a real incident — "Verified against production:
 * https://astrid.cc/llms.txt returned…", "the picker listed GitHub Copilot with
 * the string copilot@astrid.cc as its id", "middleware redirects the naked
 * domain astrid.cc -> www.astrid.cc with a 308". None of those is a
 * whitelabeling hazard: a partner build does not assert them, it reads them. The
 * only way to "convert" such a file was to reword accurate evidence into
 * vagueness, which is a worse test suite (AWTD-867).
 *
 * Deliberately conservative: only a line that STARTS with a comment marker
 * counts as prose. A trailing comment after code is left in scope, because
 * `'https://astrid.cc'` itself contains `//` — a general comment stripper would
 * eat the literal out of a live assertion and report a false pass. Over-counting
 * costs one file on a list; a false pass costs the ratchet.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')
}

/** The file's ASSERTIONS: its source with whole-line comments removed. */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(line => !isCommentLine(line))
    .join('\n')
}

const offenders = testFiles(TESTS_DIR)
  .map(file => relative(ROOT, file))
  .filter(file => file !== SELF)
  .filter(file => codeOnly(readFileSync(join(ROOT, file), 'utf8')).includes('astrid.cc'))
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
