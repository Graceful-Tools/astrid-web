/**
 * RATCHET — task 72717eff. Jon: "Fix this and add rules test to enforce going
 * forward."
 *
 * The envelope rule (tests/rules/v1-envelope-callsites.test.ts) enforces the
 * bug I found. This one enforces the task's actual headline: raw `fetch()`
 * calls bypassing lib/api.
 *
 * WHY MUTATIONS ONLY, and not all 189 call sites. The client API layer is not
 * a style preference — apiPost/apiPut/apiDelete route through
 * OfflineSyncManager.queueMutation(), so a write issued while offline is
 * queued and replayed. A raw `fetch()` for a mutation has no such path: the
 * write is attempted, it fails, and it is GONE. The user saw a form submit and
 * nothing happened.
 *
 * A raw GET degrades far more honestly — a read that fails is visible as a
 * missing thing rather than a silently discarded change. So the sharp edge is
 * mutations, and pointing the rule at exactly the sharp edge is what makes it
 * worth obeying.
 *
 * A RATCHET, NOT A BAN. 126 of these exist across 62 files, and plenty are
 * defensible: admin dashboards, debug pages and the auth flows have no useful
 * offline story. Failing the suite on all of them would get this file deleted,
 * so it fails only when the number GOES UP.
 *
 * WHEN THIS FAILS, on a user-facing write, use apiPost/apiPut/apiDelete from
 * lib/api. If the call genuinely cannot — a streaming upload, a request that
 * needs its own AbortSignal, an admin-only screen — raise CEILING with the
 * reason in the commit message. That is a deliberate act, not a reflex.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/**
 * Client-side raw `fetch()` MUTATIONS to this app's API, as of task 72717eff
 * (2026-08-14). Lower as call sites adopt lib/api; raise only with a reason.
 *
 * 126 -> 125 on 2026-08-15: lib/webhooks/comment-notifier stopped fetching this
 * app's own /api/coding-workflow/start-tools-workflow and now calls the function
 * directly (task 46acd19c). A server-to-server self-fetch was never a client
 * mutation, but it counted like one — and removing it is the same win either way.
 *
 * 127 -> 126 when the branch was merged: extracting useTaskShareLink collapsed
 * the share-link POST that task-detail.tsx and task-detail-viewonly.tsx each
 * issued into one call in the hook. Neither branch could see that on its own —
 * the slack check found it in the merge, which is the case it exists for.
 */
const CEILING = 125

const CLIENT_DIRS = ['app', 'components', 'hooks', 'contexts', 'lib']
const FETCH_TO_API = /fetch\(\s*[`'"]([^`'"]*\/api\/[^`'"]*)[`'"]/g
const MUTATING_METHOD = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

function rawFetchMutations(): string[] {
  const found: string[] = []

  for (const dir of CLIENT_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file)

      // Route handlers are the SERVER. A fetch there is an outbound call, not
      // a client bypassing the client layer.
      if (rel.startsWith('app/api/')) continue
      // The layer itself, and the offline machinery it delegates to.
      if (rel === 'lib/api.ts' || rel.startsWith('lib/offline')) continue

      const source = readFileSync(file, 'utf8')
      const pattern = new RegExp(FETCH_TO_API.source, 'g')
      let match: RegExpExecArray | null

      while ((match = pattern.exec(source)) !== null) {
        // The method sits in the options object just after the url. Bounded
        // rather than file-wide so an unrelated POST elsewhere in the file
        // cannot make a GET look like a mutation.
        const window = source.slice(match.index, match.index + 300)
        const method = window.match(MUTATING_METHOD)
        if (method) found.push(`${rel} → ${method[1]} ${match[1]}`)
      }
    }
  }
  return found
}

describe('client-side raw fetch mutations do not grow (task 72717eff)', () => {
  const offenders = rawFetchMutations()

  it(`stays at or below ${CEILING} raw fetch mutations`, () => {
    expect(
      offenders.length,
      offenders.length > CEILING
        ? `A new client-side write bypasses lib/api. Offline, apiPost/apiPut/` +
          `apiDelete queue the mutation and replay it; a raw fetch loses it ` +
          `silently. Use the layer, or raise CEILING here WITH a reason.`
        : `Down to ${offenders.length}. Lower CEILING to lock the gain in.`
    ).toBeLessThanOrEqual(CEILING)
  })

  it('the ceiling is not left slack', () => {
    expect(
      CEILING - offenders.length,
      `CEILING is ${CEILING} but only ${offenders.length} raw mutations remain. ` +
        `Lower CEILING to ${offenders.length}.`
    ).toBeLessThanOrEqual(0)
  })
})
