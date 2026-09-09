/**
 * RULE — task f5022e72.
 *
 * `vitest.risk.config.ts` hand-maintains a list of test files and a list of
 * source files, and holds the second to a coverage floor by running the first.
 * Both lists are exact paths, and vitest treats a path that matches nothing as
 * simply nothing — no warning, no error.
 *
 * So renaming or moving one of those tests does not break the gate. It shrinks
 * it. The security surface it was guarding drops out of the run, coverage of
 * the corresponding source file drops to zero, and the threshold that was
 * supposed to catch exactly that... is computed over the files that are left.
 * The suite stays green while the thing it exists to protect stops being
 * protected.
 *
 * The lists themselves stay hand-maintained: they are the DEFINITION of the
 * risk surface, and deriving them from a glob would mean the surface grows by
 * accident. What must not happen is that they rot without saying so.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const CONFIG = 'vitest.risk.config.ts'

/**
 * Read the two path lists straight out of the config source.
 *
 * Deliberately textual rather than importing the config: importing it would
 * resolve `mergeConfig` and the plugin graph, and this rule needs to survive a
 * config that fails to load — that being one of the ways it could rot.
 */
function pathsInBlock(source: string, blockStart: string): string[] {
  const start = source.indexOf(blockStart)
  if (start === -1) return []
  const openBracket = source.indexOf('[', start)
  const closeBracket = source.indexOf(']', openBracket)
  const block = source.slice(openBracket, closeBracket)

  // Comments live INSIDE these arrays, next to the entries they explain, and
  // they quote paths — including paths that were removed for not existing.
  // Reading those back as entries would report the very thing the comment says
  // was fixed. (It did, on this rule's first run.)
  const code = block
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')

  return [...code.matchAll(/'([^']+)'/g)].map(m => m[1])
}

const source = readFileSync(join(ROOT, CONFIG), 'utf8')
const testPaths = pathsInBlock(source, 'include: [')
const coveragePaths = pathsInBlock(source, 'include: [', ).length ? pathsInBlock(
  source.slice(source.indexOf('coverage:')),
  'include: ['
) : []

describe(`${CONFIG} paths still point at real files (task f5022e72)`, () => {
  it('finds both lists, so a restructure cannot make this rule vacuous', () => {
    // A rule that silently parses nothing passes forever. These counts are the
    // rule's own smoke test.
    expect(testPaths.length).toBeGreaterThan(5)
    expect(coveragePaths.length).toBeGreaterThan(5)
  })

  it('every test file in the risk include exists', () => {
    const missing = testPaths.filter(p => !existsSync(join(ROOT, p)))

    expect(
      missing,
      `These are listed in ${CONFIG} but do not exist:\n` +
        missing.map(p => `  ${p}`).join('\n') +
        `\n\nVitest matches nothing and says nothing, so the risk gate just got ` +
        `smaller. Update the path — do not delete the line.`
    ).toEqual([])
  })

  it('every source file under the coverage floor exists', () => {
    const missing = coveragePaths.filter(p => !existsSync(join(ROOT, p)))

    expect(
      missing,
      `These are held to a coverage threshold in ${CONFIG} but do not exist:\n` +
        missing.map(p => `  ${p}`).join('\n') +
        `\n\nA threshold over a file that is not there is met trivially.`
    ).toEqual([])
  })
})
