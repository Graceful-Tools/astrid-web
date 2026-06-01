/**
 * Threshold gate for task-list virtualization (task a48b2d24).
 *
 * Virtualization only kicks in for pathologically long lists, and never while
 * a manual-sort drag is active (the drag relies on every row being mounted so
 * it can measure + reorder). Below the threshold — i.e. essentially every real
 * list — the existing full render is used unchanged, so there is zero
 * regression risk for the common case.
 */

/** Lists at or below this length render normally (no virtualization). */
export const VIRTUALIZE_TASK_THRESHOLD = 150

export function shouldVirtualizeTaskList(
  taskCount: number,
  manualSortActive: boolean,
  threshold: number = VIRTUALIZE_TASK_THRESHOLD,
): boolean {
  if (manualSortActive) return false
  return taskCount > threshold
}
