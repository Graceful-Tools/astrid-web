/**
 * RULE — nothing in the blocking feature may encode a blocker COUNT (AWTD-1002).
 *
 * The ask was "usable for 1–3, which is most common, but no hard coded
 * numbers", and those are compatible only because 1–3 is a LAYOUT TARGET rather
 * than a limit: chips wrap and the row grows, so ten blockers render as ten
 * chips. The moment a `slice(0, 3)` or a `MAX_BLOCKERS` appears, the tuning
 * target has quietly become a constraint the data assumes — and that is exactly
 * the mistake the requirement named in advance.
 *
 * Checked as a grep because the mistake is textual. It is not trying to
 * understand the layout.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** Every file the feature is implemented in. */
const FEATURE_FILES = [
  'lib/task-dependencies.ts',
  'services/task-dependency.service.ts',
  'components/task-detail/TaskDetailBlockersRow.tsx',
  'app/api/v1/tasks/[id]/blockers/route.ts',
  'app/api/v1/tasks/[id]/blockers/[blockingTaskId]/route.ts',
]

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /MAX_BLOCKERS/, why: 'a blocker ceiling' },
  { pattern: /\.slice\(\s*0\s*,\s*\d+\s*\)/, why: 'truncating the blocker list' },
  { pattern: /\+\s*\{?\s*(more|remaining)/i, why: 'a "+n more" affordance' },
  // A depth constant in the cycle walk is the same mistake in the other
  // direction: the walk is bounded by its visited set.
  { pattern: /maxDepth|MAX_DEPTH/, why: 'a depth limit on the cycle walk' },
]

/**
 * Comments are stripped before the grep, because the files are allowed — and
 * meant — to SAY that there is no `MAX_BLOCKERS`. A rule that forbids naming
 * itself teaches nobody anything.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')
}

describe('no hard-coded blocker count (AWTD-1002)', () => {
  it('finds the feature files', () => {
    // A renamed file would make every assertion below vacuously pass.
    for (const file of FEATURE_FILES) {
      expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true)
    }
  })

  for (const file of FEATURE_FILES) {
    it(`${file} encodes no blocker count`, () => {
      const source = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(source), `${file} looks like it contains ${why}`).toBe(false)
      }
    })
  }

  it('the schema puts no ceiling on the relation', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
    const model = schema.slice(schema.indexOf('model TaskDependency'))
    const body = model.slice(0, model.indexOf('\n}'))
    // A join row per blocker. A `blockedByTaskId` scalar on Task would cap a
    // task at one blocker, which is still a hard-coded number.
    expect(body).toMatch(/blockedTaskId/)
    expect(body).toMatch(/blockingTaskId/)
    expect(schema).not.toMatch(/blockedByTaskId\s+String/)
  })
})
