import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))
vi.mock('@/lib/feature-flags', () => ({ getEffectiveFeatures: vi.fn() }))

import { GET } from '@/app/api/v1/features/route'
import { getUnifiedSession } from '@/lib/session-utils'
import { getEffectiveFeatures } from '@/lib/feature-flags'

const mockSession = vi.mocked(getUnifiedSession)
const mockFeatures = vi.mocked(getEffectiveFeatures)

describe('GET /api/v1/features', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires authentication', async () => {
    mockSession.mockResolvedValue(null)
    const response = await GET(new NextRequest('http://localhost/api/v1/features'))
    expect(response.status).toBe(401)
  })

  it('returns only effective values for the current user', async () => {
    mockSession.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, image: null } })
    mockFeatures.mockResolvedValue({ version: 42, features: { google_tasks: false } })
    const response = await GET(new NextRequest('http://localhost/api/v1/features'))
    expect(await response.json()).toEqual({ version: 42, features: { google_tasks: false } })
    expect(mockFeatures).toHaveBeenCalledWith('user-1')
  })

  it('uses ETags to avoid sending unchanged configuration', async () => {
    mockSession.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, image: null } })
    mockFeatures.mockResolvedValue({ version: 42, features: { google_tasks: false } })
    const first = await GET(new NextRequest('http://localhost/api/v1/features'))
    const etag = first.headers.get('etag')!
    const second = await GET(new NextRequest('http://localhost/api/v1/features', { headers: { 'If-None-Match': etag } }))
    expect(second.status).toBe(304)
  })
})
