/**
 * RULE — AWTD-1237.
 *
 * `boardTasksUrl` asks the server to leave `description` out, so a task from
 * one of these responses has NO `description` key at all. `undefined` is not
 * an error: it reads as "this task has no description" in every truthiness
 * check it will meet, so a caller that starts reading the field gets silence
 * rather than a failure, and the bug ships.
 *
 * This is the guard. Any script that builds its read with `boardTasksUrl` must
 * never touch `description` on what comes back.
 *
 * If you need descriptions, do not widen this rule — build the URL without
 * `omit` and say in a comment why that reader needs the other 80% of the
 * payload. `monitor-vercel-logs.ts` is the existing example.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPTS = join(process.cwd(), 'scripts')

/** Every script that reads a board through the lean helper. */
function sweepScripts(): string[] {
  return readdirSync(SCRIPTS)
    .filter(name => name.endsWith('.ts'))
    .filter(name => readFileSync(join(SCRIPTS, name), 'utf8').includes('boardTasksUrl'))
}

describe('board sweeps do not read description', () => {
  it('covers the scripts that actually use the lean read', () => {
    // If this drops to zero the rule below is vacuous — it would pass while
    // guarding nothing, which is the failure mode of every source-scanning test.
    expect(sweepScripts().length).toBeGreaterThan(0)
  })

  for (const name of sweepScripts()) {
    it(`${name} never reads a description it did not ask for`, () => {
      const source = readFileSync(join(SCRIPTS, name), 'utf8')
      const offenders = source
        .split('\n')
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => /\.description\b/.test(line))
        // A comment explaining the absence is the point, not a violation.
        .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))

      expect(
        offenders,
        `${name} builds its read with boardTasksUrl, which omits description — ` +
          `these lines would silently see undefined:\n` +
          offenders.map(o => `  ${name}:${o.number}  ${o.line}`).join('\n'),
      ).toEqual([])
    })
  }
})
