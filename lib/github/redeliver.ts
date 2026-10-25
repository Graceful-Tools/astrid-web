/**
 * Redeliver the App's failed webhook deliveries (AWTD-1153, spec §8.7).
 *
 * GitHub does not retry a delivery that failed — a deploy, a timeout, a 5xx —
 * so an edit made during one would wait for the next reconcile. This asks
 * GitHub for recent deliveries once an hour and redelivers each failed one
 * exactly once. Reconcile still heals anything this misses.
 */

import { getGitHubApp } from './app'
import { RedisCache } from '@/lib/redis'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.redeliver')

/** Deliveries older than this are left to reconcile. */
const WINDOW_MS = 2 * 60 * 60 * 1000

export interface HookDelivery {
  id: number
  guid: string
  status_code: number
  redelivery: boolean
  delivered_at: string
  event: string
}

type Request = (route: string, params?: Record<string, unknown>) => Promise<{ data: unknown }>

export function failedDeliveries(deliveries: HookDelivery[], now: number): HookDelivery[] {
  return deliveries.filter(
    d =>
      !d.redelivery &&
      (d.status_code === 0 || d.status_code >= 400) &&
      now - Date.parse(d.delivered_at) <= WINDOW_MS,
  )
}

export async function redeliverFailedDeliveries(deps: {
  request?: Request
  claim?: (key: string) => Promise<boolean>
  now?: number
} = {}): Promise<{ redelivered: number }> {
  const request: Request = deps.request ?? ((route, params) => getGitHubApp().octokit.request(route, params))
  const claim = deps.claim ?? (key => RedisCache.claimOnce(key, 24 * 60 * 60))
  const now = deps.now ?? Date.now()

  const { data } = await request('GET /app/hook/deliveries', { per_page: 100 })
  let redelivered = 0
  for (const delivery of failedDeliveries(data as HookDelivery[], now)) {
    // Once per delivery, across instances and hourly runs.
    if (!(await claim(`github:redeliver:${delivery.guid}`))) continue
    try {
      await request('POST /app/hook/deliveries/{delivery_id}/attempts', { delivery_id: delivery.id })
      redelivered++
    } catch (err) {
      log.warn({ err, guid: delivery.guid }, 'GitHub redelivery failed')
    }
  }
  if (redelivered > 0) log.info({ redelivered }, 'Redelivered failed GitHub webhook deliveries')
  return { redelivered }
}
