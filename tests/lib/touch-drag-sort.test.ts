/**
 * Which devices drag by TOUCH (Jon, 2026-08-19: "Drag and drop sub tasks
 * doesn't work on web iPad touch").
 *
 * iPadOS Safari never fires HTML5 drag events from a finger — `draggable`,
 * `dragstart`, `dragover` and `drop` are mouse/trackpad only. The app has a
 * touch drag path for exactly this reason (the grabber handle plus
 * hooks/use-mobile-drag-sort.ts), but it was gated on
 * `isMobile && isMobilePhoneDevice()`, and an iPad is neither: the UA test
 * matches Mobile/Android/iPhone/iPod, and iPad lands in tablet-2-column /
 * tablet-3-column so `isMobile` is false too.
 *
 * So an iPad got `draggable={true}` — a mechanism its touchscreen cannot
 * drive — and no grabber, which is no drag at all.
 *
 * THE TABLET KEEPS HTML5 DRAG TOO, and that is the point of returning two
 * flags rather than one. An iPad with a Magic Keyboard trackpad drags exactly
 * like a desktop, so flipping it wholesale onto the phone's path (which turns
 * `draggable` OFF) would have fixed touch by breaking trackpad. The two input
 * methods coexist on one device, so the capability has to describe both.
 */

import { describe, it, expect } from 'vitest'
import { taskDragCapability } from '@/lib/touch-drag-sort'

describe('taskDragCapability', () => {
  it('gives a touch iPad both paths — grabber for the finger, draggable for the trackpad', () => {
    expect(taskDragCapability({ isMobileLayout: false, hasPhoneUserAgent: true, isTablet: true, hasTouch: true })).toEqual({
      touchDrag: true,
      html5Drag: true,
    })
  })

  it('leaves the phone exactly as it was: touch only, no HTML5 drag', () => {
    expect(taskDragCapability({ isMobileLayout: true, hasPhoneUserAgent: true, isTablet: false, hasTouch: true })).toEqual({
      touchDrag: true,
      html5Drag: false,
    })
  })

  it('leaves the desktop exactly as it was: HTML5 drag only, no grabber', () => {
    expect(taskDragCapability({ isMobileLayout: false, hasPhoneUserAgent: false, isTablet: false, hasTouch: false })).toEqual({
      touchDrag: false,
      html5Drag: true,
    })
  })

  it('does not put a grabber on a tablet-width window that has no touchscreen', () => {
    // A desktop browser narrowed to tablet width reports the tablet layout.
    // Nothing there can drive a touch drag, and the grabber would be dead UI.
    expect(taskDragCapability({ isMobileLayout: false, hasPhoneUserAgent: false, isTablet: true, hasTouch: false })).toEqual({
      touchDrag: false,
      html5Drag: true,
    })
  })

  it('does not call an iPad a phone just because its user agent says "Mobile"', () => {
    // Measured on an iPad Mini in WebKit:
    //   Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) ... Mobile/15E148 Safari
    // so isMobilePhoneDevice() is TRUE there. Only the layout tells them apart.
    // Getting this wrong turns `draggable` off on a tablet and breaks trackpad
    // dragging while appearing to fix touch.
    expect(
      taskDragCapability({
        isMobileLayout: false,
        hasPhoneUserAgent: true,
        isTablet: true,
        hasTouch: true,
      }),
    ).toEqual({ touchDrag: true, html5Drag: true })
  })

  it('never leaves a device with no way to drag at all', () => {
    for (const isMobileLayout of [true, false]) {
      for (const hasPhoneUserAgent of [true, false]) {
        for (const isTablet of [true, false]) {
          for (const hasTouch of [true, false]) {
            const capability = taskDragCapability({
              isMobileLayout,
              hasPhoneUserAgent,
              isTablet,
              hasTouch,
            })
            expect(
              capability.touchDrag || capability.html5Drag,
              `layout=${isMobileLayout} phoneUA=${hasPhoneUserAgent} tablet=${isTablet} touch=${hasTouch} can drag by neither method`,
            ).toBe(true)
          }
        }
      }
    }
  })
})
