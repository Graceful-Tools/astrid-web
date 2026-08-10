/**
 * No client code may call `/api/user/*` (task 641a7615, decision 3A).
 *
 * Every call site now points at a `/api/v1/users/me/*` successor, which is what
 * makes deleting the legacy prefix at sunset a deletion rather than a migration.
 * A single new `fetch('/api/user/...')` would quietly re-create the dependency,
 * and nothing else would notice until the routes were gone.
 *
 * The migration was not a rename. Two of the mappings do not follow from the
 * names, and this file records them because a future migrator will reach for
 * the obvious match:
 *
 * - `/api/user/settings` → `/api/v1/users/me/smart-tasks`. There IS a
 *   `/api/v1/users/me/settings`, and it is a DIFFERENT resource — identity plus
 *   reminder settings, not task-creation preferences.
 * - `/api/user/ai-assistant-settings` → `/api/v1/users/me/ai-preferences`,
 *   while `/api/user/ai-model-preferences` → `.../ai-model-preferences`. The
 *   names cross over.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['components', 'hooks', 'app', 'lib']

/**
 * Modules that hold legacy paths as DATA rather than calling them: the
 * retirement's rename table, its census, and the iOS contract maps. Stripping
 * comments is not enough for these — the paths are string literals by
 * necessity, since naming the old path is the entire job.
 *
 * Narrow on purpose. The guard's value is catching a real `fetch`, and a broad
 * exemption would let one hide in any file that also happens to document.
 */
const DESCRIBES_THE_API = [
  'lib/legacy-api-coverage.ts',
  'lib/api-deprecation.ts',
  'lib/legacy-api-usage.ts',
  'lib/api-contracts/',
]
const CODE = /\.(ts|tsx)$/
/** A quoted `/api/user/...` path — i.e. an actual call. */
const LEGACY_CALL = /['"`]\/api\/user\//

/**
 * Comments are stripped first. Several files legitimately DISCUSS the legacy
 * prefix — api-deprecation.ts is the module that tracks its retirement, and the
 * v1 routes each name the legacy route they replaced. Matching prose would make
 * this guard fire on the documentation of the very migration it is protecting.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // The legacy routes themselves still exist until sunset; they are the
      // thing being retired, not a caller of it.
      if (full.startsWith(join('app', 'api', 'user'))) continue
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full, out)
    } else if (CODE.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('legacy /api/user/* has no client callers (task 641a7615)', () => {
  it('finds no quoted /api/user/ path outside the legacy routes themselves', () => {
    const offenders = ROOTS.flatMap((root) => walk(root))
      .map((file) => file.replace(/\\/g, '/'))
      .filter((file) => !DESCRIBES_THE_API.some((prefix) => file.startsWith(prefix)))
      .filter((file) => LEGACY_CALL.test(stripComments(readFileSync(file, "utf8"))))

    expect(offenders).toEqual([])
  })
})
