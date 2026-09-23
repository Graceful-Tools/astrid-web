/**
 * RATCHET — AWTD-994.
 *
 * On 2026-09-22 predeploy exited non-zero while reporting ZERO failing tests,
 * because the failure was a COLLECTION error rather than a test result:
 *
 *   No "agentEmail" export is defined on the "@/lib/brand/agent-emails" mock
 *     ❯ lib/ai/agent-config.ts:214  ❯ lib/ai/ensure-agent-user.ts:15
 *
 * The named file was tests/api/user-search-scope-leak.test.ts, which passes in
 * isolation and passed again on the next full run — so the report read as a
 * flake in a file nobody had touched. It was not. Two conditions had to line up,
 * and only one of them is under a test author's control:
 *
 *   - that test replaced `@/lib/brand/agent-emails` WHOLESALE with a factory
 *     returning only `openClawEmailSuffix`, which makes every other export of
 *     the module — `agentEmail` among them — undefined;
 *   - it mocked `@/lib/api-auth-middleware` by its ALIAS path while
 *     `lib/api-auth-wrapper.ts` imports it by a RELATIVE one. Those normally
 *     resolve to one module id and the mock applies. When resolution state says
 *     otherwise, the real middleware loads, pulls in `ensure-agent-user` ->
 *     `agent-config`, and calls `agentEmail()` at module scope — into the hole
 *     the first condition left.
 *
 * The second is vite resolution-cache state, which is why this appeared on one
 * run and not the next. The first is the one worth banning, and banning it is
 * enough on its own: with the real module loaded, `agentEmail` exists however
 * the alias resolves.
 *
 * There is nothing to isolate a test FROM here. `lib/brand/agent-emails.ts` is
 * pure brand data — `lib/brand/config.ts` has no imports at all and
 * `lib/ai/harness-agents.ts` is a static table — so a stub buys no speed, no
 * determinism and no severed dependency. It buys one hole per export it forgets.
 *
 * SCOPED TO THIS ONE MODULE, deliberately. Wholesale-mocking
 * `@/lib/brand/capabilities` and `@/lib/brand/config` is established practice in
 * ~15 files, and those two have a reason a stub cannot be replaced by the real
 * thing: a test that needs a capability OFF has to say so. Widening this rule to
 * `lib/brand/**` would be a refactor of fifteen files, not a ratchet.
 *
 * A partial mock is still fine — `vi.mock(path, async (importOriginal) => ...)`
 * spreads the real exports and then overrides, so it cannot omit anything. That
 * is the shape to reach for if a future test genuinely needs to bend one of
 * these functions; see tests/api/calendar-ics-cache-privacy.test.ts for it in
 * use against `@/lib/brand/capabilities`.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const TESTS_DIR = join(ROOT, 'tests')

/** This rule names the offending shape in order to explain it. It is not an offender. */
const SELF = relative(ROOT, __filename)

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) testFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * A `vi.mock('@/lib/brand/agent-emails', <factory>)` whose factory does not
 * reach for the real module.
 *
 * `importOriginal` and `importActual` are the two ways to spread the real
 * exports, so a factory mentioning either is a partial mock and allowed. The
 * match is deliberately one line wide: every mock of this module in the repo's
 * history has been a one-liner, and a multi-line factory that spreads the
 * original names one of those two helpers on the line that opens it.
 */
const WHOLESALE_MOCK = /vi\.mock\(\s*['"]@\/lib\/brand\/agent-emails['"]\s*,(?!.*(?:importOriginal|importActual))/

function offenders(): string[] {
  return testFiles(TESTS_DIR)
    .filter(file => relative(ROOT, file) !== SELF)
    .filter(file =>
      readFileSync(file, 'utf8')
        .split('\n')
        .some(line => WHOLESALE_MOCK.test(line)),
    )
    .map(file => relative(ROOT, file))
}

describe('@/lib/brand/agent-emails is never stubbed wholesale (AWTD-994)', () => {
  it('no test replaces the module with a factory that omits its other exports', () => {
    expect(offenders()).toEqual([])
  })

  it('the pattern it bans is the shape that broke the 2026-09-22 predeploy', () => {
    // Guards the regex itself: a rule that silently stops matching reports a
    // false pass forever, and this one exists precisely because the failure it
    // catches names an innocent file.
    const broken = "vi.mock('@/lib/brand/agent-emails', () => ({ openClawEmailSuffix: () => '.oc@example.com' }))"
    const partial = "vi.mock('@/lib/brand/agent-emails', async (importOriginal) => ({"

    expect(WHOLESALE_MOCK.test(broken)).toBe(true)
    expect(WHOLESALE_MOCK.test(partial)).toBe(false)
  })
})
