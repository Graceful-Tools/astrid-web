#!/usr/bin/env node
/**
 * Run the scheduled jobs on a self-hosted deployment (AWTD-1286).
 *
 * On Vercel, the platform calls each route in `vercel.json` `crons` on its
 * schedule. Anywhere else nothing does, and nothing says so: reminders stop,
 * GitHub sync stops, abandoned uploads pile up. This is that caller. It reads
 * the same `vercel.json`, so a job added there runs here too, and calls each
 * route with `Authorization: Bearer $CRON_SECRET` (lib/cron-auth.ts).
 *
 *   node scripts/cron-runner.mjs                  # run forever (the compose `cron` service)
 *   node scripts/cron-runner.mjs --print-crontab  # emit crontab(5) lines instead
 *
 * Environment: CRON_SECRET (required), CRON_BASE_URL (default NEXTAUTH_URL),
 * the origin the app answers on — in compose, http://app:3000.
 *
 * Run exactly one runner per deployment: two would call every job twice.
 * A job still running when it comes due again is skipped, not stacked.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cronJobs, cronMatches, crontabLines } from './lib/cron-schedule.mjs'

const configPath = resolve(process.env.CRON_CONFIG ?? 'vercel.json')
const jobs = cronJobs(JSON.parse(readFileSync(configPath, 'utf8')))
const baseUrl = (process.env.CRON_BASE_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')

if (!baseUrl) {
  console.error('cron-runner: set CRON_BASE_URL (or NEXTAUTH_URL) to the app origin')
  process.exit(1)
}

if (process.argv.includes('--print-crontab')) {
  console.log(`# Generated from ${configPath}. Times are UTC: run under CRON_TZ=UTC or TZ=UTC.`)
  for (const line of crontabLines(jobs, baseUrl)) console.log(line)
  process.exit(0)
}

const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('cron-runner: CRON_SECRET is required; every cron route fails closed without it')
  process.exit(1)
}

/** Vercel's longest function limit is 800 s; nothing scheduled should outlive it. */
const JOB_TIMEOUT_MS = 15 * 60 * 1000
const running = new Set()
/** Paths that answered 404: a capability this brand turned off (lib/brand/capabilities.ts). */
const absent = new Set()

function log(fields) {
  console.log(JSON.stringify({ at: new Date().toISOString(), source: 'cron-runner', ...fields }))
}

async function run(job) {
  if (running.has(job.path)) {
    log({ path: job.path, skipped: 'previous run still in progress' })
    return
  }
  running.add(job.path)
  const started = Date.now()
  try {
    const response = await fetch(`${baseUrl}${job.path}`, {
      headers: { authorization: `Bearer ${secret}`, 'user-agent': 'astrid-cron-runner' },
      signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
    })
    await response.arrayBuffer()
    // A route gated on a capability this deployment turned off answers 404 on
    // every run. Say so once instead of once a minute.
    if (response.status === 404) {
      if (!absent.has(job.path)) {
        absent.add(job.path)
        log({ path: job.path, status: 404, note: 'not on this deployment (a capability is off); quiet until it answers otherwise' })
      }
      return
    }
    absent.delete(job.path)
    log({ path: job.path, status: response.status, ms: Date.now() - started })
  } catch (error) {
    log({ path: job.path, error: String(error?.message ?? error), ms: Date.now() - started })
  } finally {
    running.delete(job.path)
  }
}

function tick() {
  const now = new Date()
  for (const job of jobs) {
    if (cronMatches(job.cron, now)) void run(job)
  }
  // Wake a second into the next minute, so clock jitter never skips or doubles one.
  setTimeout(tick, 60_000 - (Date.now() % 60_000) + 1_000)
}

log({ started: true, baseUrl, jobs: jobs.map(job => `${job.schedule} ${job.path}`) })
setTimeout(tick, 60_000 - (Date.now() % 60_000) + 1_000)

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0))
