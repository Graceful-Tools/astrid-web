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

import { spawnSync } from 'node:child_process'

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

/**
 * ADEV-31: whether this predeploy run may file or comment on a board task.
 *
 * Only a run on main, or on a merged commit behind it (the gate worktree), files.
 * A feature branch's red gate is that branch's business: on 2026-11-16 all three
 * "Predeploy Failed" tasks on the web board came from branches, and each one
 * outranked real work at the top of Ready. Without an `origin/main` ref (a
 * shallow CI checkout) it trusts `GITHUB_REF`. `ASTRID_PREDEPLOY_FILE_TASKS`
 * set to 1 forces filing and 0 forbids it.
 */
export function predeployReportScope(opts: {
  cwd: string
  env: Record<string, string | undefined>
}): { file: boolean; reason: string } {
  const force = opts.env.ASTRID_PREDEPLOY_FILE_TASKS
  if (force === '1') return { file: true, reason: 'ASTRID_PREDEPLOY_FILE_TASKS=1' }
  if (force === '0') return { file: false, reason: 'ASTRID_PREDEPLOY_FILE_TASKS=0' }
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: opts.cwd, stdio: 'ignore' }).status === 0
  // ADEV-44: staged or modified work on top of a main commit is work in progress.
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: opts.cwd, encoding: 'utf8' })
  if (dirty.status === 0 && dirty.stdout.trim() !== '') {
    return { file: false, reason: 'working tree has uncommitted changes (work in progress)' }
  }
  if (git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main')) {
    return git('merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main')
      ? { file: true, reason: 'HEAD is on origin/main' }
      : { file: false, reason: 'HEAD is not on origin/main (a branch run)' }
  }
  return opts.env.GITHUB_REF === 'refs/heads/main'
    ? { file: true, reason: 'GITHUB_REF is main' }
    : { file: false, reason: 'no origin/main ref and GITHUB_REF is not main' }
}
