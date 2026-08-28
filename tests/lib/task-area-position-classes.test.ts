/**
 * The mobile board must be as tall as the SCREEN, not as tall as its cards
 * (Jon, 2026-08-18: "On desktop, scrolling tasks within the board row works as
 * intended, but on mobile, it's not getting the screen height correctly, so
 * it's off").
 *
 * MainContent's task-area wrapper carried BOTH `relative` and `absolute`.
 * Tailwind emits `.absolute` before `.relative`, so `relative` won and the
 * wrapper — which the code intends to stretch between its parent's top and
 * bottom — became an auto-height element in normal flow. Everything below it
 * inherits that: the board's `h-full` columns and their `flex-1 overflow-y-auto`
 * bodies have no bound to size against, so instead of scrolling they grow.
 *
 * Measured on an iPhone 12 viewport (390x664) before the fix: the wrapper was
 * 1975px tall, the column body's scrollHeight equalled its clientHeight (1808 —
 * i.e. it never scrolled), and the column's bottom sat at y=2015, 1351px below
 * a screen that cannot scroll (the app locks body overflow). After: wrapper
 * 600px, board bottom exactly 664, column body clientHeight 433 against
 * scrollHeight 1808 — it scrolls.
 *
 * LIST VIEW IS DELIBERATELY UNTOUCHED. It renders correctly today precisely
 * because it lands on `relative`, and `.mobile-task-list-container` caps itself
 * with `max-height: 100dvh`. Flipping it to `absolute` too would be a rewrite
 * of a layout nobody reported as broken.
 */

import { describe, it, expect } from 'vitest'
import { taskAreaPositionClasses, bodyClearsFloatingHeader } from '@/lib/task-area-position-classes'

const classesOf = (result: string) => result.split(/\s+/).filter(Boolean)

describe('taskAreaPositionClasses', () => {
  it('pins the mobile board wrapper to its parent box so the columns get a height', () => {
    const classes = classesOf(taskAreaPositionClasses({ isMobile: true, boardMode: true }))
    expect(classes).toContain('absolute')
    expect(classes).toContain('inset-x-0')
    expect(classes).toContain('bottom-0')
    expect(classes).not.toContain('relative')
  })

  it('leaves the mobile list wrapper in flow, exactly as it renders today', () => {
    const classes = classesOf(taskAreaPositionClasses({ isMobile: true, boardMode: false }))
    expect(classes).toContain('relative')
    expect(classes).not.toContain('absolute')
  })

  it('keeps the desktop wrapper a flex child', () => {
    const classes = classesOf(taskAreaPositionClasses({ isMobile: false, boardMode: true }))
    expect(classes).toContain('relative')
    expect(classes).toContain('flex-1')
    expect(classes).toContain('min-w-0')
    expect(classes).not.toContain('absolute')
  })

  it('never emits two positioning classes at once — that conflict IS the bug', () => {
    for (const isMobile of [true, false]) {
      for (const boardMode of [true, false]) {
        const classes = classesOf(taskAreaPositionClasses({ isMobile, boardMode }))
        const positions = classes.filter(cls =>
          ['static', 'fixed', 'absolute', 'relative', 'sticky'].includes(cls),
        )
        expect(
          positions,
          `isMobile=${isMobile} boardMode=${boardMode} emitted ${positions.join(' + ')}`,
        ).toHaveLength(1)
      }
    }
  })
})

describe('bodyClearsFloatingHeader (task 6443e6a2)', () => {
  it('pads only when the header actually floats — mobile with the drawer', () => {
    expect(bodyClearsFloatingHeader({ isMobile: true, isIOSDrawer: true })).toBe(true)
  })

  it('does NOT pad tablet/desktop board mode, where the header is in normal flow', () => {
    // The regression: isIOSDrawer is true in board mode on ANY layout, but the
    // header only floats on mobile. Padding here stacked on the in-flow
    // header's height — a ~70px empty band above the board on iPad.
    expect(bodyClearsFloatingHeader({ isMobile: false, isIOSDrawer: true })).toBe(false)
  })

  it('does not pad plain desktop, where there is no drawer at all', () => {
    expect(bodyClearsFloatingHeader({ isMobile: false, isIOSDrawer: false })).toBe(false)
  })
})
