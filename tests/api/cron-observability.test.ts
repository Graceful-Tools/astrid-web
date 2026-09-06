/**
 * RED for task f74c9370 — the cron jobs are unobservable.
 *
 * The reported symptom was that only the FIRST log line of
 * /api/cron/reminders ever reaches the logs. The filed hypothesis was that
 * pino buffers and loses the last line before the response; that is disproven
 * (pino 10 writes to stdout synchronously — 502/502 lines survive an immediate
 * process.exit through a pipe).
 *
 * The shape that actually fits — first line present, everything after it
 * absent — is an early return at requireCronSecret. And requireCronSecret
 * logs NOTHING on either path, so "authorised and did the work" and "rejected
 * at the door" produce identical output. That is the defect either way:
 *
 *   - a rejected cron leaves no trace, which is how every scheduled route
 *     could 401 for weeks unnoticed (task a5eb65a4);
 *   - a successful run reports no counts, so the logs cannot say whether it
 *     processed 500 reminders or zero;
 *   - the summary is an interpolated string, not data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const warn = vi.hoisted(() => vi.fn())
const info = vi.hoisted(() => vi.fn())
const error = vi.hoisted(() => vi.fn())
const debug = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn, info, error, debug }),
  default: { warn, info, error, debug },
}))

function req(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cron/reminders', { headers })
}

const ORIGINAL = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env = { ...ORIGINAL }
})

describe('cron authorisation leaves a trace (task f74c9370)', () => {
  it('logs a WARNING when a cron request is rejected for a bad secret', async () => {
    process.env.CRON_SECRET = 'right'
    const { requireCronSecret } = await import('@/lib/cron-auth')

    const blocked = requireCronSecret(req({ authorization: 'Bearer wrong' }))

    expect(blocked?.status).toBe(401)
    expect(warn, 'a rejected cron must be visible in the logs').toHaveBeenCalled()
  })

  it('logs a WARNING when no CRON_SECRET is configured at all', async () => {
    delete process.env.CRON_SECRET
    // NODE_ENV is 'test' here, so the local opt-out branch is reachable only
    // with the explicit flag; without it this is the production-shaped path.
    delete process.env.ALLOW_UNAUTHENTICATED_CRON
    const { requireCronSecret } = await import('@/lib/cron-auth')

    const blocked = requireCronSecret(req())

    expect(blocked?.status).toBe(401)
    // This is the exact silence that let every scheduled route 401 for weeks.
    expect(warn).toHaveBeenCalled()
    const message = JSON.stringify(warn.mock.calls)
    expect(message).toMatch(/CRON_SECRET/)
  })

  it('says so when a cron is let through by the local opt-out', async () => {
    delete process.env.CRON_SECRET
    process.env.ALLOW_UNAUTHENTICATED_CRON = 'true'
    const { requireCronSecret } = await import('@/lib/cron-auth')

    expect(requireCronSecret(req())).toBeNull()
    expect(warn, 'an unauthenticated cron must never be silent').toHaveBeenCalled()
  })

  it('does not warn on the ordinary authorised path', async () => {
    process.env.CRON_SECRET = 'right'
    const { requireCronSecret } = await import('@/lib/cron-auth')

    expect(requireCronSecret(req({ authorization: 'Bearer right' }))).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('cron jobs report what they did (task f74c9370)', () => {
  it('logs ONE structured summary carrying duration and counts', async () => {
    const { runCronJob } = await import('@/lib/cron-observability')

    const response = await runCronJob('reminders', async () => ({
      remindersSent: 7,
      retried: 2,
    }))

    expect(response.status).toBe(200)

    const summary = info.mock.calls.find(
      ([payload]) => payload && typeof payload === 'object' && 'durationMs' in payload
    )
    expect(summary, 'no structured summary was logged').toBeTruthy()
    expect(summary![0]).toMatchObject({ job: 'reminders', remindersSent: 7, retried: 2 })
    expect(typeof summary![0].durationMs).toBe('number')
  })

  it('puts the same counts in the response body, which no log can lose', async () => {
    const { runCronJob } = await import('@/lib/cron-observability')

    const response = await runCronJob('reminders', async () => ({ remindersSent: 7 }))
    const body = await response.json()

    expect(body).toMatchObject({ success: true, job: 'reminders', remindersSent: 7 })
    expect(typeof body.durationMs).toBe('number')
  })

  it('reports a failure as a 500 with the job named, and logs it', async () => {
    const { runCronJob } = await import('@/lib/cron-observability')

    const response = await runCronJob('reminders', async () => {
      throw new Error('database gone')
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ success: false, job: 'reminders' })
    expect(error).toHaveBeenCalled()
  })
})
