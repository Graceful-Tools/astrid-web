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
import { drainSyncJobs, enqueueHydrate } from '@/services/github-sync-jobs.service'

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
