/**
 * Which drag mechanisms a device can actually drive.
 *
 * HTML5 drag-and-drop (`draggable`, `dragstart`, `dragover`, `drop`) is a
 * mouse/trackpad protocol. iOS and iPadOS Safari never synthesise those events
 * from a finger, so a touchscreen needs the separate touch path — the grabber
 * handle on the row plus the state machine in hooks/use-mobile-drag-sort.ts.
 *
 * The gate for that path used to be `isMobile && isMobilePhoneDevice()`, which
 * excluded the iPad twice over: `isMobilePhoneDevice()` matches only
 * Mobile/Android/iPhone/iPod user agents, and an iPad resolves to
 * tablet-2-column / tablet-3-column so `isMobile` is false as well. The result
 * was an iPad holding `draggable={true}` — a mechanism its touchscreen cannot
 * drive — and no grabber, i.e. no way to drag at all (task: subtask drag on
 * iPad touch, 2026-08-19).
 *
 * TWO FLAGS, NOT ONE, because a tablet has BOTH input methods at once. An iPad
 * with a Magic Keyboard trackpad drags exactly like a desktop. Moving it onto
 * the phone's path would have turned `draggable` off and fixed the finger by
 * breaking the trackpad. So the tablet answer is additive: keep HTML5 drag,
 * add the touch path alongside it.
 *
 * The phone stays touch-only. There is no trackpad to serve, and leaving
 * `draggable` on there caused the long-press-to-drag conflicts the touch path
 * was written to avoid.
 */

export interface TaskDragCapability {
  /** Render the grabber handle and attach the document touch listeners. */
  touchDrag: boolean
  /** Keep the HTML5 `draggable` attribute — mouse and trackpad still need it. */
  html5Drag: boolean
}

export function taskDragCapability({
  isMobileLayout,
  hasPhoneUserAgent,
  isTablet,
  hasTouch,
}: {
  /** The 1-column mobile layout. */
  isMobileLayout: boolean
  /** `isMobilePhoneDevice()` — a Mobile/Android/iPhone/iPod user agent. */
  hasPhoneUserAgent: boolean
  /** The tablet layout (an iPad, or an Android tablet reporting the same). */
  isTablet: boolean
  /** The device reports a touchscreen. */
  hasTouch: boolean
}): TaskDragCapability {
  /*
   * BOTH SIGNALS, because either alone calls an iPad a phone. Measured on an
   * iPad Mini in WebKit:
   *
   *   Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) ... Mobile/15E148 Safari
   *
   * That UA contains "Mobile", so `isMobilePhoneDevice()` is TRUE on an iPad.
   * Only the layout separates them — an iPad reports tablet-2-column, never
   * the mobile layout. This conjunction is the whole reason the rule is here
   * and not inlined at the call site: drop the layout half and a tablet gets
   * the phone's answer, which turns `draggable` off and breaks the trackpad.
   */
  const isPhone = isMobileLayout && hasPhoneUserAgent

  // Phone: touch is the only input there is.
  if (isPhone) return { touchDrag: true, html5Drag: false }

  // Tablet WITH a touchscreen: both, because it has both. The `hasTouch` half
  // matters — a desktop window narrowed to tablet width reports the tablet
  // layout too, and a grabber it cannot use is dead UI.
  if (isTablet && hasTouch) return { touchDrag: true, html5Drag: true }

  // Everything else: unchanged.
  return { touchDrag: false, html5Drag: true }
}
