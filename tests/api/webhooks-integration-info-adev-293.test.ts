/**
 * The claude/openai/gemini integration webhooks are unauthenticated, read-only
 * setup descriptions (ADEV-293). They must stay that way: no side effects, no
 * real credential in the sample payload. Whether they have any caller left is
 * tracked on ADEV-293 (astrid-ios must be checked before deleting them).
 */
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import * as claude from '@/app/api/webhooks/claude-integration/route'
import * as gemini from '@/app/api/webhooks/gemini-integration/route'
import * as openai from '@/app/api/webhooks/openai-integration/route'

const routes = { claude, gemini, openai }

describe.each(Object.entries(routes))('/api/webhooks/%s-integration (ADEV-293)', (name, route) => {
  const url = `http://localhost/api/webhooks/${name}-integration`

  it('GET describes the endpoint as active', async () => {
    const res = await route.GET(new NextRequest(url))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'active' })
  })

  it('POST answers ready and echoes no secret', async () => {
    const res = await route.POST(new NextRequest(url, { method: 'POST', body: '{}' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ready')
    expect(JSON.stringify(body)).not.toMatch(/\bsk-[A-Za-z0-9]|Bearer |eyJ/)
  })
})
