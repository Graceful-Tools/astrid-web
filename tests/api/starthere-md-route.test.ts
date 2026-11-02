/**
 * GET /starthere.md points each agent at the server it was read from — a
 * preview's guide must connect to the preview's /mcp — but never at a host
 * outside this brand, since the response is publicly cached.
 */

import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from '@/app/starthere.md/route'
import { BRAND } from '@/lib/brand/config'
import { getBaseUrl } from '@/lib/base-url'

async function guideFor(url: string): Promise<string> {
  const res = await GET(new NextRequest(url))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/markdown')
  return res.text()
}

describe('GET /starthere.md', () => {
  it('uses a brand preview host as the origin for every command', async () => {
    const body = await guideFor(`https://preview-x.${BRAND.domain}/starthere.md`)
    expect(body).toContain(`claude mcp add --transport http ${BRAND.wordmark.toLowerCase()} https://preview-x.${BRAND.domain}/mcp`)
  })

  it('uses localhost for a local server', async () => {
    const body = await guideFor('http://localhost:3000/starthere.md')
    expect(body).toContain('http://localhost:3000/mcp')
  })

  it('ignores a foreign host and falls back to the configured base URL', async () => {
    const body = await guideFor('https://evil.example/starthere.md')
    expect(body).not.toContain('evil.example')
    expect(body).toContain(`${getBaseUrl()}/mcp`)
  })
})
