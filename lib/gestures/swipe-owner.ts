/**
 * What, other than the swipe surface `boundary`, owns a touch that starts on `target`, if anything
 * (AWTD-1534).
 *
 * - A target outside the surface's DOM is in a portal (a dialog, a menu). React still bubbles its
 *   touch events through the surface, so without this a swipe on the dialog moved the panel behind it.
 * - A target inside an element that scrolls sideways belongs to that scroller. Dragging a trade-off
 *   grid's columns, or a wide code block, read as swipe-right-to-close and closed the task.
 *
 * An element that fits its content does not scroll, so a swipe across it still counts.
 */
export function touchOwner(target: EventTarget | null, boundary: EventTarget | null): 'portal' | 'scroller' | null {
  if (!(target instanceof Node) || !(boundary instanceof Node)) return null
  if (!boundary.contains(target)) return 'portal'
  for (let el: Node | null = target; el && el !== boundary; el = el.parentNode) {
    if (el instanceof HTMLElement && scrollsSideways(el)) return 'scroller'
  }
  return null
}

function scrollsSideways(el: HTMLElement): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false
  const overflowX = (typeof window !== 'undefined' ? window.getComputedStyle(el).overflowX : '') || el.style.overflowX
  return overflowX === 'auto' || overflowX === 'scroll'
}
