/**
 * The OAuth settings dialogs fit on a phone.
 *
 * Reported from mobile: "Cannot scroll the page on mobile for ai scopes".
 * Measured with Playwright at 390x664 (iPhone 13), before the fix:
 *
 *   dialog height 836, top -86, bottom 750
 *   pageScrollable: false
 *   scroll containers inside the dialog: none
 *   buttons reachable without scrolling: []
 *
 * So it was worse than "does not scroll". The dialog overflowed BOTH ends of
 * the screen, nothing anywhere could scroll, and every control — Cancel,
 * Update Scopes, and even the ✕ — sat off-screen. On a phone the dialog could
 * not be used and could not be dismissed.
 *
 * WHY IT HAPPENS, and why it will happen again. `components/ui/dialog.tsx`
 * renders `DialogContent` fixed and centred with `translate-y(-50%)` and caps
 * NO height. Any dialog whose body is taller than the viewport therefore hangs
 * off both edges with no scroller. Every dialog in this file that survives
 * mobile does so because it solved that itself — which is why a new one
 * silently does not.
 *
 * `max-h` ALONE IS NOT THE FIX, which is the part worth pinning. Capping the
 * height lets the body scroll but pushes the action row down inside the
 * scrolled region, so "Update Scopes" is reachable only after scrolling, on a
 * control the user is in the middle of reading. The shape that works is a
 * column with exactly one scrolling child and the footer OUTSIDE it.
 *
 * These assertions are deliberately about structure rather than exact classes:
 * a cap, a scroller, and a footer that does not scroll away.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIALOGS = [
  'components/oauth-scope-group-dialog.tsx',
  'components/oauth-client-edit-dialog.tsx',
] as const

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), 'utf8')
}

/** The `<DialogContent ...>` opening tag, where the height cap has to live. */
function dialogContentTag(src: string): string {
  const start = src.indexOf('<DialogContent')
  expect(start, 'no <DialogContent> in this file').toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('>', start))
}

describe.each(DIALOGS)('%s fits a phone', file => {
  it('caps its height, so it cannot hang off both ends of the screen', () => {
    const tag = dialogContentTag(source(file))

    expect(
      tag,
      `DialogContent caps no height of its own (components/ui/dialog.tsx). Without a ` +
        `max-h here, a body taller than the viewport overflows top AND bottom with ` +
        `nothing to scroll — measured at 390x664: top -86, bottom 750, no controls reachable.`,
    ).toMatch(/max-h-\[/)
  })

  it('is a column with a scrolling body, not one tall box', () => {
    const src = source(file)
    const tag = dialogContentTag(src)

    expect(tag, 'the cap needs a flex column for the body to size against').toMatch(/flex flex-col/)

    // `min-h-0` is load-bearing: a flex child defaults to min-height:auto, which
    // refuses to shrink below its content, so `overflow-y-auto` never engages
    // and the cap pushes the overflow outside the dialog instead.
    expect(
      src,
      `the body must be the one scrolling child — flex-1 min-h-0 overflow-y-auto. ` +
        `Without min-h-0 the flex child will not shrink and the scroller never engages.`,
    ).toMatch(/flex-1 min-h-0 overflow-y-auto/)
  })

  it('keeps its action row out of the scrolling region', () => {
    const src = source(file)

    // The footer is the element that must NOT scroll away: it carries the
    // button the dialog exists to let someone press.
    const footer = src.match(/className="shrink-0 flex flex-wrap items-center justify-end[^"]*"/)
    expect(
      footer,
      `the Cancel/confirm row must sit OUTSIDE the scroller with shrink-0. Inside it, ` +
        `the confirm button is reachable only after scrolling — which is how this bug ` +
        `read on a phone even once a max-h was added.`,
    ).not.toBeNull()
  })
})
