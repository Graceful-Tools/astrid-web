/**
 * RATCHET — task 051b76b0 (the OAuth consent page could not be scrolled).
 *
 * `styles/components.css` locks `html, body { overflow: hidden }` so the
 * task-manager shell owns all vertical scrolling. That is deliberate: without
 * it, iOS Safari scrolls the document to bring a focused input into view and
 * drags the floating header off-screen.
 *
 * The cost is that any page rendered OUTSIDE that shell has to opt back into
 * scrolling, with `ScrollShell` / `scrollShellClassName`. A page that forgets
 * does not look broken in code review — `min-h-screen` reads like exactly the
 * right class — and it does not look broken on a desktop viewport either. It
 * breaks only when the content outgrows the window, and then it breaks
 * silently: the content is still in the DOM, still reachable by a scripted
 * `scrollTop`, and simply cannot be reached by a wheel or a finger.
 *
 * That is a bad failure to rely on a human to catch, and it has now happened
 * twice by the same mechanism:
 *
 *   1. /privacy and /terms, reported while logged out. Fixed, and pinned by
 *      `e2e/document-pages-scroll.spec.ts`.
 *   2. /oauth/authorize. Measured at a 390×740 viewport: 3,545px of content,
 *      the Authorize button at y=3477, and six full wheel gestures moved it
 *      zero pixels.
 *
 * The e2e spec could not have caught the second one. It drives a list of
 * paths, and `/oauth/authorize` redirects to sign-in without a session — an
 * anonymous visit silently measures the sign-in page instead and passes. A
 * list of remembered paths also only ever covers the pages someone remembered.
 * So this is a static check over every page instead, which cannot be
 * out-remembered.
 *
 * WHAT THIS ENFORCES: a page under `app/[locale]/` that renders its own
 * full-height root, rather than delegating to `AuthenticatedApp`, must own a
 * scroll surface — in the page itself or in a layout above it.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'

const ROOT = process.cwd()
const LOCALE_ROOT = join(ROOT, 'app/[locale]')

/** The opt-back-in. Either form counts. */
const OWNS_SCROLLING = /ScrollShell|scrollShellClassName/

/**
 * A page that hands off to the task-manager shell. `AuthenticatedApp` renders
 * `.app-container`, which owns its own scrolling, so a `min-h-screen` in one
 * of these is a loading or error state inside that shell — not a page root.
 */
const DELEGATES_TO_APP_SHELL = /AuthenticatedApp/

/** The marker for "this element is meant to fill the window". */
const FULL_HEIGHT_ROOT = /min-h-screen|h-screen/

function pagesUnder(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) pagesUnder(full, out)
    else if (entry === 'page.tsx') out.push(full)
  }
  return out
}

/**
 * Does a layout at or above this page provide the scroll surface?
 *
 * `app/[locale]/admin/layout.tsx` does exactly this for every admin page,
 * which is why those pages carry a bare `min-h-screen` and are nonetheless
 * fine. Checking the ancestry rather than the page alone is what keeps this
 * rule from punishing the better pattern.
 */
function aLayoutAboveOwnsScrolling(pageFile: string): boolean {
  let dir = dirname(pageFile)
  while (dir.startsWith(join(ROOT, 'app'))) {
    const layout = join(dir, 'layout.tsx')
    if (existsSync(layout) && OWNS_SCROLLING.test(readFileSync(layout, 'utf8'))) return true
    dir = dirname(dir)
  }
  return false
}

/**
 * Pages that render a full-height root of their own and own no scroll surface,
 * as of 2026-09-11 when this ratchet was added.
 *
 * These are NOT known-good — they are the untriaged backlog this bug came out
 * of, recorded so the list can only shrink. Each needs the same look
 * /oauth/authorize got: does its content outgrow a phone viewport? If yes it
 * has the same bug; if no, it has it latently, one long error message away.
 *
 * Remove an entry when you fix the page. Do not add one: a new page here is a
 * new instance of a bug that has already been reported twice.
 */
const UNFIXED_BACKLOG = new Set([
  'app/[locale]/auth/desktop/page.tsx',
  'app/[locale]/auth/error/page.tsx',
  'app/[locale]/docs/custom-agents/page.tsx',
  'app/[locale]/s/[code]/page.tsx',
  'app/[locale]/u/[userId]/page.tsx',
])

function offenders(): string[] {
  return pagesUnder(LOCALE_ROOT)
    .filter(file => {
      const source = readFileSync(file, 'utf8')
      if (!FULL_HEIGHT_ROOT.test(source)) return false
      if (DELEGATES_TO_APP_SHELL.test(source)) return false
      if (OWNS_SCROLLING.test(source)) return false
      return !aLayoutAboveOwnsScrolling(file)
    })
    .map(file => relative(ROOT, file))
    .sort()
}

describe('standalone pages own their scrolling (task 051b76b0)', () => {
  it('no page outside the app shell grows past a clipped viewport', () => {
    const unexpected = offenders().filter(file => !UNFIXED_BACKLOG.has(file))
    expect(unexpected, [
      'These pages render a full-height root outside AuthenticatedApp but own no',
      'scroll surface. html/body are overflow:hidden, so their content below the',
      'fold is unreachable by wheel or touch — it is in the DOM and simply cannot',
      'be scrolled to.',
      '',
      'Wrap the root in <ScrollShell>, or put scrollShellClassName on it.',
    ].join('\n')).toEqual([])
  })

  it('the OAuth consent page owns a scroll surface', () => {
    // The page this ratchet came from, asserted by name so a refactor that
    // drops the shell fails with the reason attached rather than as one
    // anonymous entry in the list above.
    const source = readFileSync(join(LOCALE_ROOT, 'oauth/authorize/page.tsx'), 'utf8')
    expect(OWNS_SCROLLING.test(source)).toBe(true)
  })

  it('the backlog only shrinks', () => {
    // A page fixed but left in the list would quietly re-permit itself later.
    const current = offenders()
    const stale = [...UNFIXED_BACKLOG].filter(file => !current.includes(file)).sort()
    expect(stale, 'Fixed — remove from UNFIXED_BACKLOG so it stays fixed.').toEqual([])
  })
})
