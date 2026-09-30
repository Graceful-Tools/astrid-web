/**
 * A finished task's branch gets a pull request.
 *
 * "Done" for /fixall is: committed on its branch, gates green, pushed, task
 * completed. But a scheduled run cannot open the PR itself — `gh` is denied
 * inside `claude -p` — so on 2026-09-29 four completed tasks (AWTD-1007, 1024,
 * 1025, 1035) sat on pushed branches nobody was asked to review. The board said
 * "complete"; `main` had none of it. The runner has no such restriction, so it
 * opens the PR after the run (scripts/open-fixall-prs.ts).
 *
 * Only for tasks the run COMPLETED. A released or parked task's branch is a
 * resume point, not something to review.
 *
 * Kept apart from the script for the usual reason: it calls main() at import.
 */

export interface CandidateBranch {
  /** Branch name without `origin/`. */
  name: string
  /** Subjects AND bodies of the commits it has that main lacks. */
  messages: string[]
}

/** True when `text` names the id as a whole word — AWTD-12 must not match AWTD-125. */
function mentionsId(text: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?![0-9])`, 'i').test(text)
}

/**
 * Unmerged branches carrying this task: by NAME (fix/awtd-1025-…), or by a
 * commit that cites the id. AWTD-1035's branch was `fix/v1-update-accepts-
 * occurrence-count` — nothing in the name — but its commit said "(AWTD-1035)",
 * and the id in the commit is the convention fixall already asks for.
 */
export function branchesForCompletedTask(identifier: string | null | undefined, candidates: CandidateBranch[]): string[] {
  if (!identifier) return []
  return candidates
    .filter(branch => branch.name !== 'main' && branch.messages.length > 0)
    .filter(branch =>
      mentionsId(branch.name.replace(/[/_]/g, '-'), identifier) ||
      branch.messages.some(message => mentionsId(message, identifier)),
    )
    .map(branch => branch.name)
}

export function prTitle(task: { identifier?: string | null; title?: string | null }): string {
  const title = (task.title ?? '').replace(/\s+/g, ' ').trim()
  const short = title.length > 90 ? `${title.slice(0, 87)}...` : title
  return task.identifier ? `${task.identifier}: ${short}` : short
}

export function prBody(input: {
  task: { identifier?: string | null; title?: string | null }
  taskUrl: string
  report: string | null
}): string {
  const report = (input.report ?? '').trim()
  return [
    `Completed by the scheduled \`/fixall\` loop: [${input.task.identifier ?? 'task'}](${input.taskUrl}).`,
    '',
    report ? report : '_The run left no completion report on the task._',
    '',
    '---',
    'Opened by the runner (`scripts/open-fixall-prs.ts`) because a scheduled session cannot run `gh`. ' +
      'Not deployed: merging to `main` ships nothing until a production deploy.',
  ].join('\n')
}
