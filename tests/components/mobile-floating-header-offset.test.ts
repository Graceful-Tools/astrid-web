/**
 * The first task must clear the floating header (task 8c090700).
 *
 * `.app-header-mobile-floating` is `position: fixed`, so it hovers over the
 * content and takes no space in flow. The class that was supposed to compensate,
 * `.app-body-with-floating-header`, was EMPTY — its comment claimed padding
 * "doesn't work here because mobile content uses absolute inset-0".
 *
 * Both halves of that comment were stale. The mobile task-area wrapper resolves
 * to `position: relative`, not absolute (lib/task-area-position-classes.ts), so
 * it is in normal flow and padding on the body is exactly what moves it. An
 * empty rule with a confident comment is worse than no rule: it reads as a
 * decision someone already made.
 *
 * The offset is published at runtime by TaskManagerHeader rather than hardcoded,
 * because the header's height depends on its contents — a constant goes wrong
 * the next time a control is added, and "the first row is slightly under the
 * header" is the kind of drift nobody files twice.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(process.cwd(), 'styles/components.css'), 'utf8')
const header = readFileSync(
  join(process.cwd(), 'components/TaskManager/Header/TaskManagerHeader.tsx'),
  'utf8',
)

function ruleBody(selector: string): string {
  const start = css.indexOf(selector + ' {')
  expect(start, `${selector} not found`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('mobile floating header offset', () => {
  it('offsets the body by the header height', () => {
    const body = ruleBody('.app-body-with-floating-header')
    expect(body, 'the compensating rule is still empty').toContain('padding-top')
    expect(body).toContain('--mobile-floating-header-height')
  })

  it('keeps a fallback, so a failed measurement does not collapse the offset to zero', () => {
    // var() with no fallback resolves to nothing and the padding is dropped
    // entirely — the exact bug, reintroduced silently.
    expect(ruleBody('.app-body-with-floating-header')).toMatch(/var\(--mobile-floating-header-height,\s*\d+px\)/)
  })

  it('still describes the header as fixed, since that is why the offset exists', () => {
    expect(ruleBody('.app-header-mobile-floating')).toContain('fixed')
  })

  it('publishes the measured header edge from the header component', () => {
    expect(header).toContain('--mobile-floating-header-height')
    expect(header, 'measured, not hardcoded').toContain('getBoundingClientRect')
  })

  it('withdraws the offset when the header is not floating', () => {
    // On desktop the header is in flow and takes its own space; leaving a stale
    // value published would push the content down twice.
    expect(header).toContain('removeProperty')
  })

  it('re-measures rather than reading once', () => {
    expect(header).toContain('ResizeObserver')
  })
})

describe('the mobile task list never hands its scroll to the app shell (AWTD-1307)', () => {
  it('contains overscroll, so flicking past the end of the list cannot scroll the shell and the header with it', () => {
    // `.app-container` is `overflow-x: hidden`, which computes overflow-y to
    // `auto`: it IS a scroll container. html/body already stop overscroll, but
    // the list sat between them, so a flick past its end chained into the shell.
    expect(ruleBody('.mobile-task-list-container')).toMatch(/overscroll-behavior(-y)?:\s*contain/)
  })
})

describe('the app shell is not a scroll container (AWTD-1306)', () => {
  // `.app-container` was `overflow-x: hidden`, which makes it a scroll container
  // (hidden still scrolls programmatically, and computes overflow-y to auto).
  // With the list menu open the drawer content is translated 320px right, so
  // the shell gains a 320px horizontal scroll range (scrollWidth 710 against
  // 390; WebKit keeps reporting it after the menu closes). Any scrollIntoView
  // or focus that lands in the drawer — the board's scrollToColumn, keyboard
  // selection, iOS's focus scrolling — then scrolls the SHELL: measured in
  // Chromium, scrollLeft 320 with the menu open and the header slid from x=328
  // back over the menu. The floating header is fixed inside that drawer, so it
  // moves with it: "header gets out of position ... related to list menu".
  // Declarations only: the rule's comment names the old value on purpose.
  const declarations = () => ruleBody('.app-container').replace(/\/\*[\s\S]*?\*\//g, '')

  it('clips instead of hiding, so nothing can scroll the shell — not a user flick, not scrollIntoView', () => {
    const body = declarations()
    expect(body).toMatch(/overflow:\s*clip/)
    expect(body, 'overflow-x: hidden alone leaves a scrollable shell').not.toMatch(/overflow-x:\s*hidden/)
  })

  it('keeps a hidden fallback for browsers without clip, declared before it', () => {
    const body = declarations()
    const hidden = body.search(/overflow:\s*hidden/)
    const clip = body.search(/overflow:\s*clip/)
    expect(hidden).toBeGreaterThan(-1)
    expect(hidden).toBeLessThan(clip)
  })
})
