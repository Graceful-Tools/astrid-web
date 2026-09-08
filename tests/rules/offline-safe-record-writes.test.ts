/**
 * ZERO RULE — task b8b21855.
 *
 * The sibling ratchet (tests/rules/raw-fetch-mutations-ratchet.test.ts) counts
 * every client-side raw `fetch()` mutation and forbids the number going up.
 * That is the right shape for 100-odd calls of wildly different value: admin
 * screens, debug pages and auth handshakes have no useful offline story, and a
 * rule that failed on all of them would be deleted rather than obeyed.
 *
 * But a ratchet never reaches zero, and a subset of those calls is not a matter
 * of taste. This file is that subset, and it demands ZERO.
 *
 * WHICH SUBSET, AND WHY EXACTLY THESE. `apiPost`/`apiPut`/`apiPatch`/
 * `apiDelete` in lib/api.ts do not queue everything they are handed — they
 * queue specific endpoint shapes, and fall through to a plain request for the
 * rest. So "route it through the layer" only changes the OUTCOME for the calls
 * the layer would actually queue:
 *
 *   POST   /api/[v1/]tasks                  → queued (create task)
 *   POST   /api/[v1/]lists                  → queued (create list)
 *   POST   /api/[v1/]tasks/{id}/comments    → queued (create comment)
 *   PUT    /api/[v1/]{tasks,lists,comments}/{id}          → queued
 *   PATCH  /api/[v1/]{tasks,lists,comments}/{id}          → queued
 *   PATCH  /api/[v1/]lists/{id}/favorite    → queued
 *   DELETE /api/[v1/]{tasks,lists,comments}/{id}          → queued
 *
 * For one of these, a raw fetch offline throws and the edit is GONE — the user
 * renamed a list, or completed a task from a reminder, and nothing happened.
 * Through the layer the same edit lands in IndexedDB and replays on reconnect.
 * That is a behaviour difference, not a style one, which is why this rule can
 * afford to be absolute where the ratchet cannot.
 *
 * WHAT IS DELIBERATELY NOT HERE. List membership sub-resources (`/members`,
 * `/invitations`, `/leave`, `/transfer-ownership`) and the `/copy` endpoints
 * are writes under /api/lists too, but `apiPost` would not queue their POSTs,
 * so converting them changes nothing offline while making the diff look like
 * progress. They belong to the service-extraction work in AWTD-849.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** Client code that renders the app. Route handlers are the server. */
const CLIENT_DIRS = ['app', 'components', 'hooks', 'contexts', 'lib']

const FETCH_TO_API = /fetch\(\s*[`'"]([^`'"]*\/api\/[^`'"]*)[`'"]/g
const MUTATING_METHOD = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/

/**
 * The endpoint shapes lib/api.ts queues. `${...}` template holes are collapsed
 * to a single `{id}` segment before matching so a literal and an interpolated
 * URL are judged the same way.
 */
const QUEUEABLE: Array<{ method: RegExp; path: RegExp }> = [
  { method: /^POST$/, path: /^\/api\/(?:v1\/)?(?:tasks|lists)$/ },
  { method: /^POST$/, path: /^\/api\/(?:v1\/)?tasks\/\{id\}\/comments$/ },
  { method: /^(?:PUT|PATCH|DELETE)$/, path: /^\/api\/(?:v1\/)?(?:tasks|lists|comments)\/\{id\}$/ },
  { method: /^PATCH$/, path: /^\/api\/(?:v1\/)?lists\/\{id\}\/favorite$/ },
]

/**
 * Files allowed to issue one of these writes raw. Each entry needs a reason —
 * "it was already there" is not one.
 */
const EXEMPT: Record<string, string> = {
  // Handles offline itself, and does more than the layer could: it writes the
  // optimistic comment into IndexedDB and queues with the task id as parentId
  // so a comment on a still-temp task replays after its parent create.
  'lib/comment-posting.ts':
    'queues its own mutation with parent-id tracking in an explicit offline branch',
  // Developer-only screens reachable by typing the URL. The ratchet preamble
  // already exempts debug pages; they have no offline story worth queueing.
  'app/[locale]/debug-reminders/debug-reminders-client.tsx': 'debug-only screen',
  'app/[locale]/debug-reminders-enhanced/page.tsx': 'debug-only screen',
}

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

/** `/api/v1/tasks/${task.id}` → `/api/v1/tasks/{id}`, and drop any query string. */
function normalisePath(url: string): string {
  return url.replace(/\$\{[^}]*\}/g, '{id}').split('?')[0].replace(/\/$/, '')
}

function rawRecordWrites(): string[] {
  const found: string[] = []

  for (const dir of CLIENT_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file)

      if (rel.startsWith('app/api/')) continue
      if (rel === 'lib/api.ts' || rel.startsWith('lib/offline')) continue
      if (rel in EXEMPT) continue

      const source = readFileSync(file, 'utf8')
      const pattern = new RegExp(FETCH_TO_API.source, 'g')
      let match: RegExpExecArray | null

      while ((match = pattern.exec(source)) !== null) {
        const window = source.slice(match.index, match.index + 300)
        const method = window.match(MUTATING_METHOD)?.[1]
        if (!method) continue

        const path = normalisePath(match[1])
        if (!QUEUEABLE.some(q => q.method.test(method) && q.path.test(path))) continue

        const line = source.slice(0, match.index).split('\n').length
        found.push(`${rel}:${line} → ${method} ${path}`)
      }
    }
  }
  return found
}

describe('writes to task/list/comment records go through lib/api (task b8b21855)', () => {
  it('never issues a queueable record write as a raw fetch', () => {
    const offenders = rawRecordWrites()

    expect(
      offenders,
      `These writes would be QUEUED and replayed by lib/api, and are instead ` +
        `lost when the request fails offline. Use apiPost/apiPut/apiPatch/` +
        `apiDelete. If a call genuinely cannot, add it to EXEMPT with a reason:` +
        `\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
