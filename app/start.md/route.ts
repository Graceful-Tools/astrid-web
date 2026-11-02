/**
 * GET /starthere.md — the /starthere guide as plain markdown, for agents.
 *
 * Rendered from lib/start-here/business-blueprint.ts, the same source as the
 * human page, so "paste astrid.cc/starthere into your agent" and "read the
 * page yourself" give identical steps. Bypasses i18n routing because the
 * middleware matcher excludes `.md` paths.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getBaseUrl } from '@/lib/base-url'
import { BRAND } from '@/lib/brand/config'
import { startHereMarkdown } from '@/lib/start-here/business-blueprint'

/**
 * The origin the reader actually reached — what the human page shows too
 * (it reads window.location). A preview or local server must hand an agent
 * ITS OWN /mcp, not production's. Only this brand's hosts and localhost are
 * trusted; anything else (a spoofed Host header) falls back to the configured
 * base URL, so the cached response can never point agents at a foreign host.
 */
function guideOrigin(request: NextRequest): string {
  const { protocol, hostname, host } = request.nextUrl
  const domain = BRAND.domain.toLowerCase()
  const name = hostname.toLowerCase()
  const trusted =
    name === domain ||
    name.endsWith(`.${domain}`) ||
    name === 'localhost' ||
    name === '127.0.0.1'
  return trusted ? `${protocol}//${host}` : getBaseUrl()
}

export async function GET(request: NextRequest) {
  return new NextResponse(startHereMarkdown(guideOrigin(request)), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
