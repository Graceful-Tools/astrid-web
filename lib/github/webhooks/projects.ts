/**
 * `projects_v2_item` → a hydrate job (AWTD-1152, spec §8.7).
 *
 * The payload is a TRIGGER, never data: it carries ids, not field values, and
 * GitHub may deliver events out of order. So the handler only enqueues "read
 * this item again" — coalesced per item per 2 seconds — and the job reads
 * GitHub's current state. The webhook's own cost is a delivery check, one
 * indexed read and one insert (§13.3: ack ≤ 300 ms); the work runs after the
 * response, and the per-minute cron catches anything that missed it.
 */

import { hasCapability } from '@/lib/brand/capabilities'
import { runAfterResponse } from '@/lib/background'
import { createLogger } from '@/lib/logger'
import { firstDelivery } from './issues'
import { boardsForProjectNodes } from '@/services/github-projects.service'
import {
  drainSyncJobs,
  enqueueAccessRefresh,
  enqueueHydrate,
  enqueueIssueCommentSync,
} from '@/services/github-sync-jobs.service'
import { prisma } from '@/lib/prisma'
import { deleteRemoteTask } from '@/services/github-projects-lifecycle.service'

const log = createLogger('github.webhooks.projects')

export interface ProjectsV2ItemPayload {
  action?: string
  installation?: { id?: number }
  projects_v2_item?: { node_id?: string; project_node_id?: string }
}

/** Returns whether a job was enqueued. */
export async function handleProjectsV2ItemWebhook(payload: ProjectsV2ItemPayload, deliveryId?: string): Promise<boolean> {
  if (!hasCapability('githubProjects')) return false

  const itemNodeId = payload.projects_v2_item?.node_id
  const projectNodeId = payload.projects_v2_item?.project_node_id
  const installationId = payload.installation?.id
  if (!itemNodeId || !projectNodeId || !installationId) return false

  // Every org project's edits arrive here; only bound ones are ours.
  if (!(await boardsForProjectNodes([projectNodeId])).has(projectNodeId)) return false
  if (!(await firstDelivery(deliveryId))) {
    log.info({ deliveryId, itemNodeId }, 'Duplicate GitHub delivery ignored')
    return false
  }

  const enqueued = await enqueueHydrate({ installationId, itemNodeId, projectNodeId })
  runAfterResponse('github-projects-drain', () => drainSyncJobs())
  log.info({ action: payload.action, itemNodeId, enqueued }, 'projects_v2_item → hydrate')
  return enqueued
}

/**
 * `member`, `membership`, `organization`: someone's access to the org changed,
 * so every board in the installation re-derives its roles (§8.6) — coalesced
 * to one refresh per installation per 10 minutes.
 */
export async function handleOrgAccessWebhook(payload: { installation?: { id?: number } }, deliveryId?: string): Promise<boolean> {
  if (!hasCapability('githubProjects')) return false
  const installationId = payload.installation?.id
  if (!installationId || !(await firstDelivery(deliveryId))) return false
  const enqueued = await enqueueAccessRefresh(installationId)
  runAfterResponse('github-projects-drain', () => drainSyncJobs())
  return enqueued
}

/**
 * `issue_comment` (created, edited, deleted) → a re-read of that comment
 * (AWTD-1283). A trigger like `projects_v2_item`: only ids are read here, and
 * the job makes the task's copy match whatever GitHub says now.
 *
 * Every installed repo's comments arrive here, so only a mirrored issue's
 * queue a job — one indexed read. A PR's delivery names the PR only by its
 * issue-shaped node id, never the PR id its task stores, so a PR comment is
 * queued whenever the installation has a bound board and the job decides.
 *
 * No `firstDelivery` claim: the issues nudge (handleIssuesWebhook) claims this
 * same delivery id, and whichever claimed second would be dropped. A
 * redelivery coalesces on the job's key, and the job is idempotent anyway.
 */
export async function handleIssueCommentForProjects(payload: {
  action?: string
  installation?: { id?: number }
  issue?: { node_id?: string; pull_request?: unknown }
  comment?: { node_id?: string }
}): Promise<boolean> {
  if (!hasCapability('githubProjects')) return false
  const installationId = payload.installation?.id
  const commentNodeId = payload.comment?.node_id
  const issueNodeId = payload.issue?.node_id
  if (!installationId || !commentNodeId || !issueNodeId) return false

  const ours = payload.issue?.pull_request
    ? (await prisma.gitHubProjectBinding.count({ where: { installationId, detachedAt: null } })) > 0
    : (await prisma.task.count({ where: { remoteNodeId: issueNodeId } })) > 0
  if (!ours) return false

  const enqueued = await enqueueIssueCommentSync({ installationId, commentNodeId })
  runAfterResponse('github-projects-drain', () => drainSyncJobs())
  log.info({ action: payload.action, commentNodeId, enqueued }, 'issue_comment → comment sync')
  return enqueued
}

/** `issues.deleted`: the task mirroring that issue is deleted too (§8.7). */
export async function handleIssueDeletedForProjects(payload: {
  action?: string
  issue?: { node_id?: string }
}): Promise<boolean> {
  if (!hasCapability('githubProjects') || payload.action !== 'deleted' || !payload.issue?.node_id) return false
  const deleted = await deleteRemoteTask(payload.issue.node_id, 'system')
  if (deleted) log.info({ issue: payload.issue.node_id }, 'issues.deleted → mirrored task deleted')
  return deleted
}
