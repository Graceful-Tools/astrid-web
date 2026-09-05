import { describe, it, expect, vi, beforeEach } from 'vitest'

const safeHealthCheck = vi.fn()
const ensureMigrations = vi.fn()

vi.mock('@/lib/runtime-migrations', () => ({
  safeHealthCheck,
  ensureMigrations,
}))

const { GET } = await import('@/app/api/health/route')

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123'
    process.env.GIT_COMMIT_SHA = ''
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = ''
  })

  it('reports the deployed commit sha instead of a fake build timestamp', async () => {
    safeHealthCheck.mockResolvedValue({ healthy: true, responseTime: 12, error: null })
    ensureMigrations.mockResolvedValue(undefined)

    const response = await GET(new Request('http://localhost/api/health') as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.version).toBe('abc123')
    expect(body.commitSha).toBe('abc123')
    expect(body.buildTimestamp).toBe('abc123')
    expect(body.buildTime).toBe('abc123')
  })

  // The legacy census beacon silently records nothing when INTERNAL_API_SECRET
  // is unset, and the 401 looks identical from outside whether the secret is
  // wrong or missing. Health is the one place the answer is observable
  // (task 488b0183).
  it('reports whether the legacy census secret is configured', async () => {
    safeHealthCheck.mockResolvedValue({ healthy: true, responseTime: 12, error: null })
    ensureMigrations.mockResolvedValue(undefined)

    process.env.INTERNAL_API_SECRET = 'shh'
    let body = await (await GET(new Request('http://localhost/api/health') as any)).json()
    expect(body.legacyCensusConfigured).toBe(true)

    delete process.env.INTERNAL_API_SECRET
    body = await (await GET(new Request('http://localhost/api/health') as any)).json()
    expect(body.legacyCensusConfigured).toBe(false)
  })

  // Every cron route fails closed when CRON_SECRET is unset (lib/cron-auth.ts),
  // and Vercel only sends the Bearer header when the variable exists. With it
  // missing, all five scheduled jobs 401 forever and the only external symptom
  // is silence — no reminders, no digests, no analytics. That is exactly how
  // production ran unnoticed from 2026-08-19 until this review found it in the
  // logs. Health is the one place the answer is observable (task a5eb65a4).
  it('reports whether the cron secret is configured', async () => {
    safeHealthCheck.mockResolvedValue({ healthy: true, responseTime: 12, error: null })
    ensureMigrations.mockResolvedValue(undefined)

    process.env.CRON_SECRET = 'shh'
    let body = await (await GET(new Request('http://localhost/api/health') as any)).json()
    expect(body.cronSecretConfigured).toBe(true)

    delete process.env.CRON_SECRET
    body = await (await GET(new Request('http://localhost/api/health') as any)).json()
    expect(body.cronSecretConfigured).toBe(false)
  })
})
