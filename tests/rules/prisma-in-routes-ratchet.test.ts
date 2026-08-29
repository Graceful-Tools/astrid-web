/**
 * RATCHET — task 017a569a. The task's own words: a first slice "and a rule that
 * new routes use it, or it will be at 300 next year."
 *
 * Direct `@/lib/prisma` importers went 127 → 219 in the twenty months the
 * service layer sat unbuilt in a planning document. Nothing stopped the
 * growth, so nothing did.
 *
 * This is a ONE-WAY ratchet, not a ban. 151 route files import Prisma directly
 * today and converting them is many slices' work; failing the suite on all of
 * them would just get the rule deleted. It fails when the number GOES UP,
 * which is the only property that matters for "it will be at 300 next year".
 *
 * WHEN THIS FAILS, the fix is usually not to raise the number:
 *   - a route that needs an access-checked task → services/task.service.ts
 *   - a route that needs a query SHAPE with no rule attached → lib/, which is
 *     the existing and perfectly good pattern for that
 *   - a genuinely new kind of data access → lower the ceiling in a later slice
 *     rather than treating this as the budget
 *
 * Raising CEILING is a deliberate act with a reason in the commit message, not
 * a reflex. Lowering it as slices land is the point.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/**
 * Route files importing @/lib/prisma directly, as of service-layer slice 1
 * (2026-08-14). Lower this as slices land; raise it only with a stated reason.
 *
 * 151 -> 150 on 2026-08-15: extracting the tools-workflow core into
 * lib/coding-workflow/start-tools-workflow.ts (task 46acd19c) took the Prisma
 * import out of that route. The slack check is what noticed — a ceiling left
 * above the real number stops ratcheting.
 */
const CEILING = 147 // 149 → 147: both available-agents routes moved onto lib/ai/available-agents (task 9dbe0b17)

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

describe('direct Prisma use in API routes does not grow (task 017a569a)', () => {
  const offenders = routeFiles(join(ROOT, 'app/api'))
    .filter(file => readFileSync(file, 'utf8').includes('@/lib/prisma'))
    .map(file => relative(ROOT, file))

  it(`stays at or below ${CEILING} route files importing @/lib/prisma`, () => {
    expect(
      offenders.length,
      offenders.length > CEILING
        ? `A new route imports @/lib/prisma directly. Prefer services/ for an ` +
          `access rule that spans routes, or lib/ for a query shape with no rule ` +
          `attached. If neither fits, raise CEILING in this file WITH a reason.`
        : `Down to ${offenders.length}. Lower CEILING in this file to lock the gain in.`
    ).toBeLessThanOrEqual(CEILING)
  })

  it('the ceiling is not left slack after a slice lands', () => {
    // A ratchet that is allowed to drift above the real number stops ratcheting.
    // This fails when the count drops, as a prompt to lower the ceiling — the
    // one failure in this file that is good news.
    expect(
      CEILING - offenders.length,
      `CEILING is ${CEILING} but only ${offenders.length} routes import Prisma. ` +
        `Lower CEILING to ${offenders.length}.`
    ).toBeLessThanOrEqual(0)
  })
})
