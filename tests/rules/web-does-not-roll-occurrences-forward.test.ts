/**
 * RULE — the browser never computes the next occurrence (AWTD-1219, spec §10.2).
 *
 * On a GitHub-backed board a repeating task does NOT roll forward in place.
 * Completing it leaves the row completed and the server creates a new task for
 * the next occurrence, which reaches the client by SSE or delta. A client that
 * also rolls forward shows the completed occurrence springing back to life, and
 * then a second, duplicate-looking task when the real successor lands.
 *
 * **Web already satisfies this, by architecture rather than by decision.**
 * `hooks/useTaskOperations.ts` sends `completed: true` with the browser's local
 * date and timezone and lets the server do the arithmetic; nothing in the
 * client bundle calls `nextOccurrence`. AWTD-1219 assumed web rolled forward
 * like iOS and Mac do, and it does not.
 *
 * So this test exists to keep an accident true on purpose. The feature that
 * would break it is an obvious and tempting one — optimistic completion, where
 * the row updates before the server answers — and whoever writes it will not
 * know about §10.2 unless something says so.
 *
 * If this fails because you added a legitimate client-side roll-forward, the
 * fix is to gate it on `list.supports.repeatMode === 'roll_forward'` (the key
 * exists for exactly this) and to narrow the allowance below, naming why.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/** Directories that ship to the browser. `lib/` is excluded: it holds both. */
const CLIENT_DIRS = ['components', 'hooks', 'contexts']

/**
 * The server-side roll-forward, which is correct and must keep working. Listed
 * by path so the rule is about WHERE the arithmetic happens, not whether it
 * exists at all.
 */
const SERVER_ROLL_FORWARD = [
  'lib/repeating-rollover.ts',
  'lib/repeating-task-handler.ts',
  'lib/core-rules/repeating-core.ts',
]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (/\.(ts|tsx)$/.test(entry)) {
        found.push(path)
      }
    }
  }
  walk(join(process.cwd(), dir))
  return found
}

describe('the browser does not roll an occurrence forward (AWTD-1219)', () => {
  it('no client file computes the next occurrence', () => {
    const offenders: string[] = []
    for (const dir of CLIENT_DIRS) {
      for (const file of sourceFiles(dir)) {
        const source = readFileSync(file, 'utf8')
        if (/\bnextOccurrenceFor\w*\s*\(|\bnextOccurrence\s*\(/.test(source)) {
          offenders.push(file.replace(`${process.cwd()}/`, ''))
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('the server-side roll-forward is still where it belongs', () => {
    // The mirror of the rule above: this must not pass by the arithmetic having
    // been deleted everywhere, which would break every classic repeating list.
    const present = SERVER_ROLL_FORWARD.filter(path => {
      try {
        return readFileSync(join(process.cwd(), path), 'utf8').includes('nextOccurrence')
      } catch {
        return false
      }
    })

    expect(present.length).toBeGreaterThan(0)
  })

  it('the completion path sends the browser’s date rather than a computed successor', () => {
    const source = readFileSync(join(process.cwd(), 'hooks/useTaskOperations.ts'), 'utf8')

    // What the server needs to do the arithmetic correctly on the user's behalf.
    expect(source).toContain('localCompletionDate')
    expect(source).toContain('timeZone')
  })
})
