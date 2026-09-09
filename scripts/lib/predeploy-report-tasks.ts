/**
 * Which Astrid tasks belong to the self-healing predeploy script.
 *
 * Task 8ef93fb9. On 2026-09-07 AWTD-540 ("eslint 10 blocked upstream") had its
 * description replaced with a byte-identical copy of AWTD-844's predeploy
 * failure report, destroying the real content.
 *
 * The investigation cleared both scripts as the writer — `predeploy-self-healing.ts`
 * only ever POSTs a new task, comments on a match, and PATCHes `completed`;
 * `monitor-vercel-logs.ts` can update a description but its one call site passes
 * `{ completed: true }`. Nothing in the repo PUTs a report onto a task that
 * already exists, so the overwrite came from an interactive or agent
 * `update_task`, which is consistent with the activity log naming a person.
 *
 * What the investigation DID find is the same mistake task d893debc fixed for
 * the deployment monitor, still live one file away:
 *
 *   task.title.includes('Predeploy') && task.title.includes(errorSummary.slice(0, 30))
 *
 * Two substring matches over every open task on the board. A human task titled
 * "Predeploy Failed: Documentation Links — investigate" matches. So does another
 * agent's. Today that only leads to a comment; the moment anyone routes a
 * description through the same lookup — which is exactly what happened to
 * AWTD-540 by some other route — it overwrites their work.
 *
 * So the rule is the same one its sibling already learned: match the marker this
 * script WRITES, never the words a human might type. And the reason to write it
 * down twice is that the two scripts failed independently and would have been
 * fixed independently.
 */

export interface ReportTaskLike {
  id?: string
  title?: string | null
  description?: string | null
  completed?: boolean | null
}

/**
 * Written into every report this script files, and matched on read.
 *
 * A tag rather than a title convention: titles get edited by people, and the
 * moment someone rewords one, a title-shaped rule either stops matching its own
 * task or starts matching theirs.
 */
export const PREDEPLOY_REPORT_TAG = '[predeploy-report]'

/**
 * The heading this script writes into every report description. Recognises
 * reports filed before the tag existed, without falling back to bare English.
 */
const LEGACY_DESCRIPTION_MARKER = '## Automated Predeploy Failure Report'

/**
 * Exact title prefixes this script creates.
 *
 * Prefixes, not substrings: `'Predeploy'` appears in the middle of plenty of
 * sentences a person would write, and matching those is the bug.
 */
const TITLE_PREFIXES = ['🔴 Predeploy Failed:', '⏱️ Predeploy Timed Out:']

/** Is this task one the predeploy script filed? */
export function isPredeployReportTask(task: ReportTaskLike): boolean {
  const description = task.description ?? ''
  if (description.includes(PREDEPLOY_REPORT_TAG)) return true

  // Pre-tag reports: the generated heading AND an exact title prefix. Either
  // alone is too weak — a person can paste the heading into a note while
  // reporting the failure, and a title prefix alone is the original bug wearing
  // a stricter costume.
  const title = (task.title ?? '').trim()
  return (
    description.includes(LEGACY_DESCRIPTION_MARKER) &&
    TITLE_PREFIXES.some(prefix => title.startsWith(prefix))
  )
}

/**
 * The open report this run should add its comment to, or null to file a new one.
 *
 * Both conditions are required and neither is a substring of prose: the task has
 * to be one of ours, and its title has to be EXACTLY the title this run would
 * generate. Same failure, same title — a different failure gets its own task
 * rather than being appended to an unrelated one.
 */
export function findReportTaskToUpdate<T extends ReportTaskLike>(
  tasks: T[],
  generatedTitle: string,
): T | null {
  const wanted = generatedTitle.trim()
  return (
    tasks.find(
      task =>
        !task.completed &&
        isPredeployReportTask(task) &&
        (task.title ?? '').trim() === wanted,
    ) ?? null
  )
}
