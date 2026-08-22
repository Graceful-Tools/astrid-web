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
})
