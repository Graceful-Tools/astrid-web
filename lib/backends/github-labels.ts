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
import { LIST_TYPE_LABEL, LIST_TYPE_MILESTONE, isTagList } from '@/lib/list-flavors'
import type { TaskBackend, TaskBackendRow } from './types'

/** The refusal's error code. Stable: clients match on it. */
export const GITHUB_LABEL_READ_ONLY = 'github_label_read_only'

/** The refusal's error code for a milestone (AWTD-1189). Stable: clients match on it. */
export const GITHUB_MILESTONE_READ_ONLY = 'github_milestone_read_only'

/** The lists that mirror a GitHub label. */
export const GITHUB_LABEL_LIST = { listType: LIST_TYPE_LABEL, remoteNodeId: { not: null } } as const

/** The lists that mirror a GitHub milestone (AWTD-1189). */
export const GITHUB_MILESTONE_LIST = { listType: LIST_TYPE_MILESTONE, remoteNodeId: { not: null } } as const

/**
 * Every list that mirrors something GitHub owns — a label or a milestone.
 *
 * One `where` so the replica read stays a single query as flavors are added,
 * and so a new flavor cannot be mirrored inbound while staying writable
 * outbound, which is the asymmetry that would let Astrid accept a change it
 * silently loses at the next hydration.
 */
export const GITHUB_MIRRORED_LIST = {
  // Not `as const`: Prisma's `in` takes a mutable string[], and a readonly
  // tuple is rejected at every call site rather than here.
  listType: { in: [LIST_TYPE_LABEL, LIST_TYPE_MILESTONE] as string[] },
  remoteNodeId: { not: null },
} as const

type ListRefs = Array<{ id: string }>
interface ListsWrite {
  set?: ListRefs
  connect?: ListRefs
  disconnect?: ListRefs
}

/** A mirrored GitHub list a write concerns, and whether the task is on it now. */
export interface GithubLabelMembership {
  id: string
  held: boolean
  /** Which flavor it mirrors, so the refusal names the right code (AWTD-1189). */
  listType?: string | null
}

const idsOf = (refs: ListRefs | undefined) => (refs ?? []).map(ref => ref.id)

/**
 * Which mirrored list this write would add or remove, or null when it changes
 * none. Returns the FLAVOR rather than a boolean so the caller can refuse with
 * the code for the thing actually being changed — a client that special-cases
 * `github_label_read_only` must not see it for a milestone.
 */
export function mirroredListChanged(
  lists: ListsWrite | undefined,
  mirrored: readonly GithubLabelMembership[],
): GithubLabelMembership | null {
  if (!lists || mirrored.length === 0) return null
  const heldIds = new Set(mirrored.filter(row => row.held).map(row => row.id))
  const byId = new Map(mirrored.map(row => [row.id, row]))

  const set = lists.set ? new Set(idsOf(lists.set)) : null
  const joined = [...idsOf(lists.set), ...idsOf(lists.connect)].find(id => byId.has(id) && !heldIds.has(id))
  if (joined) return byId.get(joined)!

  const dropped = idsOf(lists.disconnect).find(id => heldIds.has(id))
  if (dropped) return byId.get(dropped)!

  if (set !== null) {
    const missing = [...heldIds].find(id => !set.has(id))
    if (missing) return byId.get(missing)!
  }
  return null
}

/** Would this list write add or remove a GitHub label or milestone? */
export function changesGithubLabels(lists: ListsWrite | undefined, labels: readonly GithubLabelMembership[]): boolean {
  return mirroredListChanged(lists, labels) !== null
}

/**
 * Does this list MIRROR a GitHub label? A label list someone converted from
 * their own regular list has no `remoteNodeId` and is an ordinary list.
 */
export function isGithubLabelList(list: { listType?: string | null; remoteNodeId?: string | null }): boolean {
  return isTagList(list) && Boolean(list.remoteNodeId)
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
  return isGithubLabelList(list) && (held ?? []).some(on => on.id === list.id)
}

type LoadLabels = (taskId: string | null, mentionedListIds: string[]) => Promise<GithubLabelMembership[]>

/** The GitHub label lists the write names, plus the ones the task is on. */
const loadGithubLabels: LoadLabels = async (taskId, mentionedListIds) => {
  const rows = await prisma.taskList.findMany({
    where: {
      ...GITHUB_MIRRORED_LIST,
      OR: [{ id: { in: mentionedListIds } }, ...(taskId ? [{ tasks: { some: { id: taskId } } }] : [])],
    },
    select: { id: true, listType: true, ...(taskId ? { tasks: { where: { id: taskId }, select: { id: true } } } : {}) },
  })
  return rows.map(row => ({
    id: row.id,
    listType: row.listType,
    held: ((row as { tasks?: unknown[] }).tasks ?? []).length > 0,
  }))
}

const refusalFor = (row: GithubLabelMembership) => ({
  ok: false as const,
  status: 400 as const,
  error: row.listType === LIST_TYPE_MILESTONE ? GITHUB_MILESTONE_READ_ONLY : GITHUB_LABEL_READ_ONLY,
})

export function withGithubLabelGuard(backend: TaskBackend, loadLabels: LoadLabels = loadGithubLabels): TaskBackend {
  const refusal = async (taskId: string | null, data: TaskBackendRow) => {
    const lists = data.lists as ListsWrite | undefined
    if (!lists) return null
    const mentioned = [...idsOf(lists.set), ...idsOf(lists.connect), ...idsOf(lists.disconnect)]
    const changed = mirroredListChanged(lists, await loadLabels(taskId, mentioned))
    return changed ? refusalFor(changed) : null
  }

  return {
    kind: backend.kind,
    async createTask(ctx, data) {
      const refused = ctx.origin !== 'remote' ? await refusal(null, data) : null
      if (refused) return refused
      return backend.createTask(ctx, data)
    },
    async updateTask(ctx, taskId, data) {
      const refused = ctx.origin !== 'remote' ? await refusal(taskId, data) : null
      if (refused) return refused
      return backend.updateTask(ctx, taskId, data)
    },
    deleteTask: (ctx, taskId) => backend.deleteTask(ctx, taskId),
    // A field value is not list membership, so this guard has nothing to say
    // about it — a label or milestone list can only be joined or left, which
    // is what the refusal above covers (AWTD-1209).
    setFieldValue: (ctx, taskId, fieldRemoteId, value) => backend.setFieldValue(ctx, taskId, fieldRemoteId, value),
  }
}
