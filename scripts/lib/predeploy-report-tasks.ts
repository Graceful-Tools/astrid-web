/**
 * Which Astrid tasks belong to the self-healing predeploy script.
 *
 * Task 8ef93fb9, incident A. On 2026-09-07 AWTD-540 ("eslint 10 blocked
 * upstream") had its description replaced with an unrelated task's predeploy
 * failure report. The content was destroyed and had to be reconstructed by
 * hand from the one line the activity log preserved.
 *
 * The predeploy script was not the writer — it comments rather than overwrites,
 * and its only update sends `{ completed: true }`. But its selector is the
 * shape that produces that outcome:
 *
 *     task.title.includes('Predeploy') && task.title.includes(errorSummary.slice(0, 30))
 *
 * A substring match over every open task on the board. `errorSummary` is a
 * check name — "Build", "TypeScript" — so the second condition is nearly free,
 * and the first claims any task whose title mentions Predeploy, including a
 * person's task ABOUT the predeploy gate. Today that mis-targets a comment.
 * The day someone adds a description write to that path, it mis-targets an
 * overwrite.
 *
 * This is the same lesson as `deployment-monitor-tasks.ts` next door (task
 * d893debc), where a substring match on four common words selected a
 * substantive iOS task and posted a canned resolution onto it. The rule it
 * arrived at applies unchanged: **match the marker this script WRITES, never
 * the words a human might type.**
 *
 * Deliberately a sibling module rather than a shared one. The two scripts have
 * different markers and different title shapes; a single "is this one of ours"
 * helper spanning both would have to loosen to fit, and loosening is the whole
 * bug.
 */

export interface PredeployTaskLike {
  id?: string
  title?: string | null
  description?: string | null
  completed?: boolean | null
}

/**
 * Written into every task this script creates, and matched on read.
 *
 * An explicit tag rather than a title convention: titles get edited by people,
 * and the moment someone rewords one, a title-shaped rule either stops matching
 * its own task or starts matching theirs.
 */
export const PREDEPLOY_REPORT_TAG = '[predeploy-report]'

/**
 * The heading this script writes into every report. Recognises tasks created
 * before the tag existed — but only together with a title prefix, never alone,
 * because a person quoting the report in a task of their own would otherwise
 * hand this script write access to it.
 */
const LEGACY_DESCRIPTION_MARKER = '## Automated Predeploy Failure Report'

/** The exact title prefix this script creates. Not a substring of common words. */
const LEGACY_TITLE_PREFIX = '🔴 Predeploy Failed:'

/** Is this task one the predeploy script created? */
export function isPredeployReportTask(task: PredeployTaskLike): boolean {
  const description = task.description ?? ''
  if (description.includes(PREDEPLOY_REPORT_TAG)) return true

  const title = (task.title ?? '').trim()
  return description.includes(LEGACY_DESCRIPTION_MARKER) && title.startsWith(LEGACY_TITLE_PREFIX)
}

/**
 * The tasks a new failure may be added to as a comment.
 *
 * Both conditions matter and they fail differently: the marker says "this is
 * one of mine", and matching the failing check says "this is about the same
 * problem". Without the second, every failure would pile onto the first report
 * ever filed; without the first, it lands on a stranger's task.
 */
export function selectReportTaskFor<T extends PredeployTaskLike>(
  tasks: T[],
  errorSummary: string,
): T | null {
  const summary = errorSummary.trim().toLowerCase()
  if (!summary) return null

  return (
    tasks.find(
      task =>
        !task.completed &&
        isPredeployReportTask(task) &&
        (task.title ?? '').toLowerCase().includes(summary),
    ) ?? null
  )
}
