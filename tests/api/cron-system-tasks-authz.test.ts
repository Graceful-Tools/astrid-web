/**
 * GET /api/cron/system-tasks — authorization (AWTD-1341).
 *
 * The route creates tasks for every unverified user, so it must FAIL CLOSED:
 * no CRON_SECRET configured, no Authorization header, a wrong secret, or the
 * secret in a query string are all 401 and the job never runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const createVerifyEmailTasks = vi.hoisted(() => vi.fn())
vi.mock('@/lib/system-tasks', () => ({ createVerifyEmailTasksForUnverifiedUsers: createVerifyEmailTasks }))
vi.mock('@/lib/cron-observability', () => ({
  runCronJob: async (_name: string, fn: () => Promise<unknown>) => Response.json(await fn()),
}))

import { GET } from '@/app/api/cron/system-tasks/route'

const SECRET = 'cron-secret-xyz'
const get = (headers: Record<string, string> = {}, query = '') =>
  GET(new NextRequest(`http://localhost/api/cron/system-tasks${query}`, { headers }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('ALLOW_UNAUTHENTICATED_CRON', '')
  createVerifyEmailTasks.mockResolvedValue({ created: 0 })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/cron/system-tasks authorization (AWTD-1341)', () => {
  it('AWTD-1341: no Authorization header is 401 and the job does not run', async () => {
    expect((await get()).status).toBe(401)
    expect(createVerifyEmailTasks).not.toHaveBeenCalled()
  })

  it('AWTD-1341: a wrong secret is 401', async () => {
    expect((await get({ authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await get({ authorization: SECRET })).status).toBe(401) // missing "Bearer "
    expect(createVerifyEmailTasks).not.toHaveBeenCalled()
  })

  it('AWTD-1341: the secret in a query string is not accepted', async () => {
    expect((await get({}, `?secret=${SECRET}`)).status).toBe(401)
    expect(createVerifyEmailTasks).not.toHaveBeenCalled()
  })

  it('AWTD-1341: with NO CRON_SECRET configured it fails closed, even for an empty bearer', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await get()).status).toBe(401)
    expect((await get({ authorization: 'Bearer ' })).status).toBe(401)
    expect((await get({ authorization: 'Bearer undefined' })).status).toBe(401)
    expect(createVerifyEmailTasks).not.toHaveBeenCalled()
  })

  it('AWTD-1341: the right secret runs the job (control)', async () => {
    const res = await get({ authorization: `Bearer ${SECRET}` })
    expect(res.status).toBe(200)
    expect(createVerifyEmailTasks).toHaveBeenCalledTimes(1)
  })
})
