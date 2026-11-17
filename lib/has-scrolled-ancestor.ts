/**
 * True when a scrolling ancestor of `element` is scrolled down. A downward drag over `element`
 * is then that ancestor scrolling back up, which a gesture handler must not swallow (ADEV-74).
 */
export function hasScrolledAncestor(element: HTMLElement): boolean {
  for (let el = element.parentElement; el; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true
  }
  return false
}
