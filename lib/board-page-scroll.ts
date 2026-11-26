/**
 * Horizontal paging for the wide board (ADEV-287): a wheel or trackpad swipe
 * slides to the next set of columns and snaps there, like the iPad app, rather
 * than scrolling gradually.
 */
export interface BoardPageInput {
  /** Left edge of each column, relative to the scroll content. */
  columnLefts: number[]
  scrollLeft: number
  clientWidth: number
  direction: 1 | -1
  maxScroll: number
}

/** Scroll offset one page away: a column edge, about the columns that fit from here. */
export function boardPageTarget({ columnLefts, scrollLeft, clientWidth, direction, maxScroll }: BoardPageInput): number {
  const clamp = (n: number) => Math.max(0, Math.min(maxScroll, n))
  const goal = scrollLeft + direction * clientWidth
  let snapped = columnLefts[0] ?? 0
  for (const left of columnLefts) {
    if (Math.abs(left - goal) < Math.abs(snapped - goal)) snapped = left
  }
  // Always make progress, even when a page is narrower than one column.
  if (direction === 1 && snapped <= scrollLeft) {
    const next = columnLefts.find((left) => left > scrollLeft + 1)
    return clamp(next ?? maxScroll)
  }
  if (direction === -1 && snapped >= scrollLeft) {
    const prev = [...columnLefts].reverse().find((left) => left < scrollLeft - 1)
    return clamp(prev ?? 0)
  }
  return clamp(snapped)
}
