/**
 * GET /api/cron/binding-audit — the runtime-binding audit retention job (AWTD-1670).
 *
 * The retention rules have their own tests (tests/lib/runtime-binding-audit-retention.test.ts);
 * this covers the route: the cron secret gate, the delegation, and that the summary is
 * reported. A route that deletes audit records must not do so on the way to a 401.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pruneRuntimeBindingAuditEvents = vi.hoisted(() => vi.fn())

vi.mock('@/lib/runtime-binding/audit-retention-service', () => ({ pruneRuntimeBindingAuditEvents }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { GET } = await import('@/app/api/cron/binding-audit/route')

const request = (auth?: string) =>
  ({ headers: { get: (k: string) => (k === 'authorization' ? auth ?? null : null) } }) as never

describe('GET /api/cron/binding-audit (AWTD-1670)', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'shhh'
    pruneRuntimeBindingAuditEvents.mockResolvedValue({
      operationalDays: 90, lifecycleDays: 90, operationalDeleted: 4, lifecycleDeleted: 1, capped: false,
    })
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('AWTD-1670: refuses a caller with the wrong secret and deletes nothing', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect(pruneRuntimeBindingAuditEvents).not.toHaveBeenCalled()
  })

  it('AWTD-1670: refuses a caller with no authorization header and deletes nothing', async () => {
    expect((await GET(request(undefined))).status).toBe(401)
    expect(pruneRuntimeBindingAuditEvents).not.toHaveBeenCalled()
  })

  it('AWTD-1670: runs the prune and reports its counts for an authorized cron call', async () => {
    const response = await GET(request('Bearer shhh'))
    expect(response.status).toBe(200)
    expect(pruneRuntimeBindingAuditEvents).toHaveBeenCalledTimes(1)
    expect(await response.json()).toMatchObject({
      success: true, job: 'runtime-binding-audit-retention', operationalDeleted: 4, lifecycleDeleted: 1, capped: false,
    })
  })

  it('AWTD-1670: a failing prune answers 500 rather than reporting success', async () => {
    pruneRuntimeBindingAuditEvents.mockRejectedValue(new Error('db down'))
    const response = await GET(request('Bearer shhh'))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false })
  })

  it('AWTD-1670: is scheduled daily in vercel.json, the registry the self-host and Azure runners read', () => {
    const crons = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')).crons as Array<{ path: string; schedule: string }>
    const entry = crons.find(c => c.path === '/api/cron/binding-audit')
    expect(entry).toBeDefined()
    // Once a day: minute and hour fixed, every day.
    expect(entry!.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/)
  })
})
