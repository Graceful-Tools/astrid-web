/**
 * Which backend owns a task, from the lists it is (or will be) on.
 *
 * A task is owned by an external backend if ANY of its lists is bound to it:
 * shared fields route remotely, while Astrid-only fields and personal-list
 * membership stay local (spec §5.3).
 *
 * The only external backend is a GitHub Project (AWTD-1151). A deployment
 * without the githubProjects capability — astrid.cc — never asks the
 * database: every task there is local, at no cost to any write.
 */

import { prisma } from '@/lib/prisma'
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { localTaskBackend } from './local'
import { githubProjectTaskBackend } from './github-project'
import { withGithubLabelGuard } from './github-labels'
import type { TaskBackend } from './types'

export const GITHUB_PROJECT_BACKEND = 'github_project'

interface ResolveDeps {
  githubProjects: boolean
  /** How many of these lists are bound to a GitHub Project. */
  countBound: (listIds: readonly string[]) => Promise<number>
}

const defaults: ResolveDeps = {
  get githubProjects() {
    return CAPABILITIES.githubProjects
  },
  countBound: listIds =>
    prisma.taskList.count({ where: { id: { in: [...listIds] }, backend: GITHUB_PROJECT_BACKEND } }),
}

export async function taskBackendFor(
  listIds: readonly string[],
  deps: ResolveDeps = defaults,
): Promise<TaskBackend> {
  if (!deps.githubProjects || listIds.length === 0) return localTaskBackend
  // Guarded either way: a GitHub label's list is not a bound board, so a
  // local task can be dropped onto one too (AWTD-1188).
  return withGithubLabelGuard((await deps.countBound(listIds)) > 0 ? githubProjectTaskBackend : localTaskBackend)
}

/**
 * An update is judged by the lists the task is on AND the lists it is going
 * to: moving a task off a GitHub-backed list is an edit of that list too.
 */
export function listsBeforeAndAfter(before: ReadonlyArray<{ id: string }> | null | undefined, after: readonly string[]): string[] {
  return [...new Set([...(before ?? []).map(list => list.id), ...after])]
}
