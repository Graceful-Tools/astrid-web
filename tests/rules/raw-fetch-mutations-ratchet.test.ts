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
// 107 → 108: the desktop sign-in hand-off POSTs /api/auth/desktop/grant from
// app/[locale]/auth/desktop/desktop-handoff-client.tsx (commit 2e3aa21). This
// is the documented exception rather than an oversight: the call is a
// synchronous auth handshake. It needs `redirectUrl` back in the same tick to
// send the browser to <scheme>://auth/callback, and the grant it mints is
// single-use with a five-minute life. apiPost would queue it through
// OfflineSyncManager and replay it later — by which point nobody is on the
// page to be redirected, there is no response left to read, and the code has
// very likely expired. Offline is already handled correctly there, by telling
// the user to check their connection. This file's own preamble names the auth
// flows as having no useful offline story; this is one of them.
// 108 → 97: task b8b21855 moved the eleven writes that lib/api would actually
// QUEUE onto apiPost/apiPut/apiPatch/apiDelete — list rename, list description
// (twice), agent instructions, task complete-from-reminder, the timer's comment
// and its two duration saves, list create, and both favourite toggles. Those
// are now held to zero by tests/rules/offline-safe-record-writes.test.ts, which
// is a ban rather than a ratchet because for that subset the difference is
// behavioural: queued and replayed, versus gone. What is left in THIS count is
// the genuinely discretionary remainder.
// 97 → 96: task 9377bc2c deleted the SECOND implementation of leaving a list.
// The members manager POSTed /leave itself and then handed the parent a flag
// nothing read, so it never navigated anyone anywhere; it now delegates to the
// caller's onLeave, which is the path that already worked.
const CEILING = 96 // 115 → 107: task 1b381810 deleted the dead components
// (task-form and its picker subtree, ai-api-key-manager, sync-status,
// public-task-browser, list-detail and the rest), taking their raw mutations
// with them. Nothing was migrated to the offline client here — the count fell
// because the code is gone.
// 119 → 115: CustomAgentManager registration, deletion, upload,
                    // and profile update now use the canonical client (AWTD-761)
// 122 → 119: comment edit/delete now use the canonical client
                     // so credentials, errors, and offline replay stay centralized
                     // (task d59a8024)
// 120 → 122: ManageStatusesPanel reorder (PUT) and delete (DELETE)
                    // added to /api/statuses. This panel uses raw fetch throughout
                    // because it lives behind a settings modal and does not need
                    // offline-queue semantics (task dff92fa5)
// 122 → 120: AppearanceSettings' two private settings savers
                    // went away when it moved onto the shared useUserSettings
                    // hook (task 9523d634)
// 125 → 122: three self-fetches of /api/assistant-workflow
                          // became direct lib calls (task 12b3478d)

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
