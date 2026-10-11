/**
 * GitHub Projects boards over time (AWTD-1153, P4e): reconcile, roles,
 * deletion, uninstall. Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.1,
 * §8.6, §8.7.
 *
 *   reconcileProject     page the whole project; anything we hold that GitHub
 *                        did not list is asked about by id and leaves if gone.
 *                        A killed webhook is healed here.
 *   syncBoardRoles       ListMember rows follow each user's GitHub permission
 *   deleteRemoteTask     an issue deleted on GitHub deletes its task, through
 *                        the delete service with origin 'remote'
 *   detach / reattach    uninstall or suspend → read-only; unsuspend → back
 *   purgeDetachedBoards  30 days after an uninstall, the board's replica goes
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { isListOwner } from '@/lib/list-member-utils'
import { GITHUB_PROJECT_BACKEND } from '@/lib/backends/resolve'
import { GITHUB_LABEL_LIST } from '@/lib/backends/github-labels'
import { hydrateItem, projectItemPages } from '@/lib/github/projects/hydrate'
import { fetchViewerRole, type GithubIdentity } from '@/lib/github/projects/roles'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import { applyProjectItems, boundBoard, removeProjectItem, type ApplySummary } from '@/services/github-projects.service'
import { addListMember, changeListMemberRole, removeListMember } from '@/services/list-member.service'
import { deleteTaskWithSideEffects } from '@/services/task.service'

const log = createLogger('services.github-projects-lifecycle')

/** How long an uninstalled board's replica is kept (§8.1). */
export const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

// ── Reconcile ───────────────────────────────────────────────────────────────

export interface ReconcileSummary extends ApplySummary {
  /** Held here but not listed by GitHub; asked about by id. */
  checked: number
  removed: number
}

export async function reconcileProject(projectId: string, client: GraphqlClient): Promise<ReconcileSummary> {
  const board = await boundBoard(projectId)
  if (!board) throw new Error(`Project ${projectId} is not bound to GitHub`)

  const total: ReconcileSummary = { created: 0, updated: 0, left: 0, unchanged: 0, skipped: 0, checked: 0, removed: 0 }
  const seen = new Set<string>()
  for await (const items of projectItemPages(client, board.projectNodeId)) {
    items.forEach(item => seen.add(item.id))
    const page = await applyProjectItems(board, items)
    for (const key of Object.keys(page) as Array<keyof ApplySummary>) total[key] += page[key]
  }

  // A page listing is the truth about membership, but one missed by a
  // concurrent edit must not delete anything: ask GitHub about each by id.
  const held = await prisma.gitHubProjectItem.findMany({
    where: { projectId, archived: false },
    select: { itemNodeId: true },
  })
  for (const { itemNodeId } of held.filter(row => !seen.has(row.itemNodeId))) {
    total.checked++
    const item = await hydrateItem(client, itemNodeId)
    if (item && !item.isArchived) await applyProjectItems(board, [item])
    else if (await removeProjectItem(board, itemNodeId)) total.removed++
  }

  await prisma.gitHubProjectBinding.update({ where: { projectId }, data: { lastReconciledAt: new Date() } })
  log.info({ projectId, ...total }, 'GitHub project reconciled')
  return total
}

// ── Roles ───────────────────────────────────────────────────────────────────

export interface RoleSyncSummary {
  added: number
  changed: number
  removed: number
  /** Users whose GitHub token was unusable: their membership is left as it is. */
  unknown: number
}

/**
 * Materialise the board's ListMember rows from GitHub (§8.6), for everyone
 * with access to its installation. The board owner is never removed or
 * demoted: Astrid's own invariants (a list has an owner) come first.
 */
export async function syncBoardRoles(
  projectId: string,
  userClient: (userId: string) => Promise<GraphqlClient | null>,
): Promise<RoleSyncSummary> {
  const summary: RoleSyncSummary = { added: 0, changed: 0, removed: 0, unknown: 0 }
  const board = await boundBoard(projectId)
  if (!board) return summary

  const [list, access] = await Promise.all([
    prisma.taskList.findUnique({
      where: { id: board.listId },
      select: {
        id: true,
        name: true,
        color: true,
        ownerId: true,
        isVirtual: true,
        listMembers: { select: { userId: true, role: true } },
      },
    }),
    prisma.gitHubInstallationAccess.findMany({
      where: { installationId: board.installationId },
      select: { user: { select: { id: true, name: true, email: true, image: true } } },
    }),
  ])
  if (!list) return summary

  const current = new Map(list.listMembers.map(m => [m.userId, m.role]))
  const actor = { id: board.ownerId }

  for (const { user } of access) {
    if (isListOwner(list as never, user.id)) continue
    const client = await userClient(user.id)
    if (!client) {
      summary.unknown++
      continue
    }
    const { role, identity } = await fetchViewerRole(client, board.projectNodeId)
    if (identity) await recordGithubIdentity(user.id, identity)
    const had = current.get(user.id)
    if (role && !had) {
      await addListMember({ list, member: user, role, actor })
      summary.added++
    } else if (role && had !== role) {
      await changeListMemberRole({ list, member: user, role, actor })
      summary.changed++
    } else if (!role && had) {
      await removeListMember({ list, member: user, actor })
      summary.removed++
    }
  }
  return summary
}

/**
 * Remember who a user is on GitHub, so tasks can be assigned to them
 * (AWTD-1116 P5c). Only when unrecorded or changed; a GitHub account already
 * linked to another Astrid user is left alone rather than moved.
 */
async function recordGithubIdentity(userId: string, identity: GithubIdentity): Promise<void> {
  try {
    await prisma.user.updateMany({
      // NOT alone would skip NULL (SQL: NULL <> x is NULL), the very rows to fill.
      where: { id: userId, OR: [{ githubNodeId: null }, { NOT: { githubNodeId: identity.nodeId } }] },
      data: { githubNodeId: identity.nodeId, githubUserId: identity.databaseId },
    })
  } catch (err) {
    log.warn({ err, userId }, 'GitHub identity already belongs to another user; not recorded')
  }
}

// ── Deletion ────────────────────────────────────────────────────────────────

/** An issue deleted on GitHub: its task goes too (§8.7). Returns whether one did. */
export async function deleteRemoteTask(contentNodeId: string, actorId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({ where: { remoteNodeId: contentNodeId }, select: { id: true } })
  if (!task) return false
  const result = await deleteTaskWithSideEffects({ taskId: task.id, actorId, actorName: 'GitHub', origin: 'remote' })
  return result.deleted
}

// ── Uninstall / suspend ─────────────────────────────────────────────────────

export async function detachInstallationBoards(installationId: number, now = new Date()): Promise<number> {
  const { count } = await prisma.gitHubProjectBinding.updateMany({
    where: { installationId, detachedAt: null },
    data: { detachedAt: now },
  })
  return count
}

export async function reattachInstallationBoards(installationId: number): Promise<number> {
  const { count } = await prisma.gitHubProjectBinding.updateMany({
    where: { installationId, detachedAt: { not: null } },
    data: { detachedAt: null },
  })
  return count
}

/**
 * Boards detached more than 30 days ago whose installation is GONE (an
 * uninstall, not a suspension): their replica — the mirrored tasks that are
 * on no other list, the board's list and the project — is deleted.
 */
export async function purgeDetachedBoards(now = new Date()): Promise<number> {
  const stale = await prisma.gitHubProjectBinding.findMany({
    where: { detachedAt: { lt: new Date(now.getTime() - PURGE_AFTER_MS) } },
    select: { projectId: true, installationId: true },
  })
  if (stale.length === 0) return 0

  const live = new Set(
    (
      await prisma.gitHubInstallation.findMany({
        where: { id: { in: stale.map(b => b.installationId) } },
        select: { id: true },
      })
    ).map(i => i.id),
  )

  let purged = 0
  for (const { projectId } of stale.filter(b => !live.has(b.installationId))) {
    const lists = await prisma.taskList.findMany({
      where: { projectId, backend: GITHUB_PROJECT_BACKEND },
      select: { id: true },
    })
    const listIds = lists.map(l => l.id)
    await prisma.$transaction([
      // Mirrored tasks on this board and nowhere else. A task someone also
      // put on a personal list stays theirs (§8.2). A GitHub label's list is
      // part of the replica, not somewhere else (AWTD-1188).
      prisma.task.deleteMany({
        where: {
          remoteNodeId: { not: null },
          lists: { every: { OR: [{ id: { in: listIds } }, GITHUB_LABEL_LIST] } },
          githubProjectItems: { some: { projectId } },
        },
      }),
      prisma.taskList.deleteMany({ where: { id: { in: listIds } } }),
      // The label lists that purge emptied. One still carried by another
      // board's tasks stays.
      prisma.taskList.deleteMany({ where: { ...GITHUB_LABEL_LIST, tasks: { none: {} } } }),
      prisma.project.delete({ where: { id: projectId } }),
    ])
    purged++
  }
  if (purged > 0) log.info({ purged }, 'Purged GitHub boards uninstalled more than 30 days ago')
  return purged
}
