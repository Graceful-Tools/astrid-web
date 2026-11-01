#!/usr/bin/env node
/**
 * Drain the durable job queue on a self-hosted deployment (AWTD-1460).
 *
 * On Vercel the queue (lib/jobs/) is drained by after() following each
 * enqueue and by the minute cron. A self-hosted server runs after() too, and
 * the cron runner calls the minute cron, so nothing is lost without this
 * worker — but a retry waits for the next minute. This polls
 * /api/cron/jobs every few seconds instead, and straight away again while a
 * drain keeps finding work.
 *
 *   node scripts/job-worker.mjs                # run forever (the compose `worker` service)
 *   node scripts/job-worker.mjs --healthcheck  # exit non-zero when the loop has stalled
 *
 * Environment: CRON_SECRET (required), CRON_BASE_URL (default NEXTAUTH_URL),
 * JOB_WORKER_INTERVAL_MS (default 10000).
 *
 * More than one worker is safe: a job is claimed with a conditional update,
 * so two drains never run the same job.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HEARTBEAT = join(tmpdir(), 'job-worker.heartbeat')
const INTERVAL_MS = Number(process.env.JOB_WORKER_INTERVAL_MS) || 10_000
/** A drain can run a model call; /api/cron/jobs has a 60 s limit. */
const REQUEST_TIMEOUT_MS = 90_000

if (process.argv.includes('--healthcheck')) {
  try {
    const age = Date.now() - Number(readFileSync(HEARTBEAT, 'utf8'))
    process.exit(age < REQUEST_TIMEOUT_MS + 3 * INTERVAL_MS ? 0 : 1)
  } catch {
    process.exit(1)
  }
}

const baseUrl = (process.env.CRON_BASE_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
if (!baseUrl) {
  console.error('job-worker: set CRON_BASE_URL (or NEXTAUTH_URL) to the app origin')
  process.exit(1)
}
const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('job-worker: CRON_SECRET is required; /api/cron/jobs fails closed without it')
  process.exit(1)
}

function log(fields) {
  console.log(JSON.stringify({ at: new Date().toISOString(), source: 'job-worker', ...fields }))
}

/** One drain. Resolves to how many jobs it claimed (0 on any failure). */
async function drainOnce() {
  try {
    const response = await fetch(`${baseUrl}/api/cron/jobs`, {
      headers: { authorization: `Bearer ${secret}`, 'user-agent': 'astrid-job-worker' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      log({ status: response.status, error: body?.error ?? 'drain failed' })
      return 0
    }
    if (body.claimed > 0) log({ claimed: body.claimed, succeeded: body.succeeded, failed: body.failed, dead: body.dead })
    return Number(body.claimed) || 0
  } catch (error) {
    log({ error: String(error?.message ?? error) })
    return 0
  }
}

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; process.exit(0) })

log({ started: true, baseUrl, intervalMs: INTERVAL_MS })
while (!stopping) {
  writeFileSync(HEARTBEAT, String(Date.now()))
  const claimed = await drainOnce()
  // A full drain means there may be more: go again at once.
  if (claimed === 0) await new Promise(resolve => setTimeout(resolve, INTERVAL_MS))
}
