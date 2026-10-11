/**
 * A GitHub label is GitHub's to change (AWTD-1188, P6c).
 *
 * Labels arrive from GitHub as membership in label-flavor lists
 * (lib/github/projects/labels.ts). Writing a label change through to GitHub is
 * not built, so a write from Astrid that would add or remove one is refused by
 * name. Accepting it would last only until the next hydration put it back.
 *
 * The guard wraps whichever backend owns the task: a label list is not a
 * bound board, so a local task dropped onto one is caught here too. It asks
 * the database only when a write touches list membership.
 */

import { prisma } from '@/lib/prisma'
import { LIST_TYPE_LABEL } from '@/lib/list-flavors'
import type { TaskBackend, TaskBackendRow } from './types'

/** The refusal's error code. Stable: clients match on it. */
export const GITHUB_LABEL_READ_ONLY = 'github_label_read_only'

/** The lists that mirror a GitHub label. */
export const GITHUB_LABEL_LIST = { listType: LIST_TYPE_LABEL, remoteNodeId: { not: null } } as const

type ListRefs = Array<{ id: string }>
interface ListsWrite {
  set?: ListRefs
  connect?: ListRefs
  disconnect?: ListRefs
}

/** A GitHub label list a write concerns, and whether the task is on it now. */
export interface GithubLabelMembership {
  id: string
  held: boolean
}

const idsOf = (refs: ListRefs | undefined) => (refs ?? []).map(ref => ref.id)

/** Would this list write add or remove a GitHub label? */
export function changesGithubLabels(lists: ListsWrite | undefined, labels: readonly GithubLabelMembership[]): boolean {
  if (!lists || labels.length === 0) return false
  const held = new Set(labels.filter(label => label.held).map(label => label.id))
  const offered = new Set(labels.filter(label => !label.held).map(label => label.id))

  const set = lists.set ? new Set(idsOf(lists.set)) : null
  const joins = [...idsOf(lists.set), ...idsOf(lists.connect)].some(id => offered.has(id))
  const leaves = idsOf(lists.disconnect).some(id => held.has(id)) || (set !== null && [...held].some(id => !set.has(id)))
  return joins || leaves
}

/**
 * A GitHub label the task already carries is not being ADDED to it. The
 * task service asks permission to add a task to each list it is sent, and a
 * board member is not a member of the label's list — so without this, moving
 * a labelled task between that member's own lists would be a 403.
 */
export function isHeldGithubLabel(
  list: { id: string; listType?: string | null; remoteNodeId?: string | null },
  held: ReadonlyArray<{ id: string }> | null | undefined,
): boolean {
  return list.listType === LIST_TYPE_LABEL && Boolean(list.remoteNodeId) && (held ?? []).some(on => on.id === list.id)
}

type LoadLabels = (taskId: string | null, mentionedListIds: string[]) => Promise<GithubLabelMembership[]>

/** The GitHub label lists the write names, plus the ones the task is on. */
const loadGithubLabels: LoadLabels = async (taskId, mentionedListIds) => {
  const rows = await prisma.taskList.findMany({
    where: {
      ...GITHUB_LABEL_LIST,
      OR: [{ id: { in: mentionedListIds } }, ...(taskId ? [{ tasks: { some: { id: taskId } } }] : [])],
    },
    select: { id: true, ...(taskId ? { tasks: { where: { id: taskId }, select: { id: true } } } : {}) },
  })
  return rows.map(row => ({ id: row.id, held: ((row as { tasks?: unknown[] }).tasks ?? []).length > 0 }))
}

const refusal = { ok: false as const, status: 400 as const, error: GITHUB_LABEL_READ_ONLY }

export function withGithubLabelGuard(backend: TaskBackend, loadLabels: LoadLabels = loadGithubLabels): TaskBackend {
  const refuses = async (taskId: string | null, data: TaskBackendRow): Promise<boolean> => {
    const lists = data.lists as ListsWrite | undefined
    if (!lists) return false
    const mentioned = [...idsOf(lists.set), ...idsOf(lists.connect), ...idsOf(lists.disconnect)]
    return changesGithubLabels(lists, await loadLabels(taskId, mentioned))
  }

  return {
    kind: backend.kind,
    async createTask(ctx, data) {
      if (ctx.origin !== 'remote' && (await refuses(null, data))) return refusal
      return backend.createTask(ctx, data)
    },
    async updateTask(ctx, taskId, data) {
      if (ctx.origin !== 'remote' && (await refuses(taskId, data))) return refusal
      return backend.updateTask(ctx, taskId, data)
    },
    deleteTask: (ctx, taskId) => backend.deleteTask(ctx, taskId),
  }
}
