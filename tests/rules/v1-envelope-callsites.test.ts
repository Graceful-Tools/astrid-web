/**
 * RULES TEST — task 72717eff. Jon: "Fix this and add rules test to enforce
 * going forward."
 *
 * The fix was app/[locale]/list/[id]/page.tsx, which stored the whole
 * `{ list, meta }` envelope and handed it to TaskManager as listMetadata.
 * TaskManager read `listMetadata.id` off it, got undefined, and fell back to
 * null — and `userCanRequestListChatChannel` treats a null list as "no
 * information, allow it". So chat eligibility silently defaulted OPEN for any
 * list reached by direct link.
 *
 * That bug is invisible at the call site. Nothing throws, nothing logs; a
 * field is simply undefined and a permissive default takes over. Which is why
 * a test, not a code review, is the thing that keeps it from coming back.
 *
 * WHAT THIS ENFORCES: a client-side fetch of a v1 endpoint that WRAPS its
 * response must pass the parsed body through lib/v1-response.ts rather than
 * using it directly.
 *
 * The set of wrapping endpoints is DERIVED from the route files, not listed
 * here. A hardcoded list would drift out of date exactly the way the envelope
 * itself did — and a rule that silently stops covering a route is worse than
 * no rule, because the green test reads as proof.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Which v1 routes wrap, read off the routes themselves.
 *
 * A wrapping route responds with `NextResponse.json({ task: ... })` /
 * `{ list: ... }` / `{ comment: ... }` — the resource under a key, beside
 * `meta`. Detected by that literal rather than by path, so a new wrapping
 * route is covered the day it is written.
 */
function wrappingV1Routes(): Map<string, string> {
  const routes = new Map<string, string>()
  const v1Dir = join(ROOT, 'app/api/v1')

  for (const file of walk(v1Dir)) {
    if (!file.endsWith('route.ts')) continue
    const source = readFileSync(file, 'utf8')

    // The envelope key, as it appears in a JSON response literal.
    const match = source.match(/NextResponse\.json\(\s*\{\s*(task|list|comment)\s*[,:]/)
    if (!match) continue

    // app/api/v1/tasks/[id]/route.ts -> /api/v1/tasks/[id]
    const urlPath = '/' + relative(ROOT, file).replace(/^app\//, '').replace(/\/route\.ts$/, '')

    // KNOWN LIMIT, stated rather than papered over: only ITEM endpoints are
    // covered — those whose path ends in a dynamic segment. They wrap on every
    // method, so a call site can be judged from the path alone.
    //
    // Collection endpoints cannot be. POST /api/v1/lists returns
    // `{ list, meta }` while GET returns `{ lists }`, and this rule reads
    // source text, not dataflow — it cannot tell which method a given fetch
    // uses. Including them produced false positives on correct GET callers,
    // and a rule that cries wolf is a rule someone deletes. The collection
    // shapes are pinned by the v1 response-contract tests instead.
    if (!/\[[^\]]+\]$/.test(urlPath)) continue

    routes.set(urlPath, match[1])
  }
  return routes
}

/**
 * A fetch path from client code, with its dynamic segments generalised so it
 * can be compared against a route path: `/api/v1/tasks/${id}` and
 * `/api/v1/tasks/[id]` are the same endpoint.
 */
function normalisePath(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, '[id]')
    .replace(/\[[^\]]*\]/g, '[id]')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '')
}

// `unwrapTask<Task>(...)` — the generic argument sits between the name and the
// paren, and leaving it out of this pattern made the rule report every correct
// call site as an offender on its first run.
/**
 * How far after a fetch to look for the body being read. Generous enough to
 * cover an options object and an `if (!response.ok)` block, short enough not to
 * reach the next unrelated call.
 */

/**
 * True when every property read off the parsed body in this window is `.error`.
 *
 * Error responses are bare on both surfaces, so a call site that only reaches
 * for `.error` is handling the sole case where the envelope does not apply.
 */
function readsOnlyError(window: string): boolean {
  const bindings = [...window.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*await\s+[^\n]*\.json\(\)/g)]
    .map(m => m[1])
  if (bindings.length === 0) return false

  return bindings.every(name => {
    const reads = [...window.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, 'g'))].map(m => m[1])
    return reads.length > 0 && reads.every(prop => prop === 'error')
  })
}

const WINDOW_LINES = 25

const UNWRAP_HELPERS = /unwrap(Task|List|Comment|Envelope)\s*(<[^>]*>)?\s*\(/

describe('v1 envelope call sites (task 72717eff)', () => {
  const wrapping = wrappingV1Routes()

  it('finds the wrapping v1 routes rather than trusting a hardcoded list', () => {
    // If this drops to zero the rule below silently passes forever, so the
    // detector is asserted before it is used. The three known envelopes must
    // all be represented.
    expect(wrapping.size).toBeGreaterThan(0)
    const keys = new Set(wrapping.values())
    expect(keys.has('task')).toBe(true)
    expect(keys.has('list')).toBe(true)
  })

  it('every client-side read of a wrapping v1 endpoint unwraps the envelope', () => {
    const clientDirs = ['app', 'components', 'hooks', 'lib', 'contexts'].map(d => join(ROOT, d))
    const offenders: string[] = []

    for (const dir of clientDirs) {
      for (const file of walk(dir)) {
        const rel = relative(ROOT, file)

        // Server routes PRODUCE the envelope; they are not call sites.
        // lib/v1-response.ts is the canonical home of the unwrapping, and this
        // file names the paths it is describing.
        if (rel.startsWith('app/api/')) continue
        if (rel === 'lib/v1-response.ts') continue
        if (rel.startsWith('tests/')) continue

        const source = readFileSync(file, 'utf8')
        if (!source.includes('/api/v1/')) continue

        const lines = source.split('\n')

        for (let i = 0; i < lines.length; i++) {
          const pathMatch = lines[i].match(/['"`](\/api\/v1\/[^'"`]*)['"`]/)
          if (!pathMatch) continue

          const path = normalisePath(pathMatch[1])
          const entry = [...wrapping].find(([routePath]) => normalisePath(routePath) === path)
          if (!entry) continue

          // Judge the CALL, not the file. A file-wide check flagged pages that
          // read `.json()` somewhere unrelated while only checking
          // `response.ok` on the v1 fetch itself — six of the seven hits on the
          // first honest run were that.
          const window = lines.slice(i, i + WINDOW_LINES).join('\n')

          // Not read at all: a fetch that only inspects status cannot
          // mishandle a shape it never looks at.
          if (!/\.json\(\)/.test(window)) continue

          // Handled correctly, by any of the three spellings in use. The helper
          // is preferred, but destructuring the envelope key or naming it in a
          // generic is equally safe, and a rule that only accepts its favourite
          // idiom is a rule that fails honest code.
          const key = entry[1]
          const handled =
            UNWRAP_HELPERS.test(window) ||
            new RegExp(`\\{\\s*${key}\\s*[,}]`).test(window) ||
            new RegExp(`<\\s*\\{\\s*${key}\\s*:`).test(window)
          if (handled) continue

          // An ERROR body is not enveloped — `{ error: '...' }` is the same
          // shape on both surfaces — so `const data = await response.json();
          // throw new Error(data.error)` is correct code and must not be
          // flagged. Detected by the parsed value being read for nothing but
          // `.error`, rather than by trying to recognise an `if (!response.ok)`
          // block, which appears in several shapes here.
          if (readsOnlyError(window)) continue

          offenders.push(`${rel}:${i + 1} → ${path} (returns { ${key}, meta })`)
        }
      }
    }

    expect(
      [...new Set(offenders)].sort(),
      'These read a v1 endpoint that wraps its response without handling the ' +
        'envelope. The body is { task | list | comment, meta } — reading .id off ' +
        'it yields undefined with no error, which is how chat eligibility ' +
        'silently defaulted open on the list page. Use unwrapTask/unwrapList/' +
        'unwrapComment from lib/v1-response.ts.'
    ).toEqual([])
  })
})
