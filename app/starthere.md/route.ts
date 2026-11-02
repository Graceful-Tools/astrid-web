/**
 * GET /starthere.md — the /starthere guide as plain markdown, for agents.
 *
 * Rendered from lib/start-here/business-blueprint.ts, the same source as the
 * human page, so "paste astrid.cc/starthere into your agent" and "read the
 * page yourself" give identical steps. Bypasses i18n routing because the
 * middleware matcher excludes `.md` paths.
 */

import { NextResponse } from 'next/server'
import { getBaseUrl } from '@/lib/base-url'
import { startHereMarkdown } from '@/lib/start-here/business-blueprint'

export async function GET() {
  return new NextResponse(startHereMarkdown(getBaseUrl()), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
