/**
 * GET /api/v1/empathy-art — the manifest of high-fidelity empathy-state frames (ADEV-142).
 *
 * The art is optional decoration for empty board columns: clients prefetch it while idle and
 * keep their built-in art until a frame is cached. A new `revision` changes the art without an
 * app release. The frames themselves are static, content-hashed and cached forever
 * (next.config.ts, /images/empathy-art).
 *
 * Unauthenticated on purpose: it is the same for every user, names nothing about anyone, and the
 * frame URLs it lists are public files anyway. Answers 304 to a matching If-None-Match.
 *
 * Contract and rotation rule: docs/API_CONTRACT.md ("GET /api/v1/empathy-art").
 */
import { NextResponse } from 'next/server'
import { getBaseUrl } from '@/lib/base-url'
import { buildEmpathyArtManifest, EMPATHY_ART_REVISION } from '@/lib/empathy-art/manifest'

export const dynamic = 'force-dynamic'

const ETAG = `"${EMPATHY_ART_REVISION}"`
const CACHE_HEADERS = {
  ETag: ETAG,
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
}

export async function GET(request: Request) {
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && ifNoneMatch.split(',').some(tag => tag.trim().replace(/^W\//, '') === ETAG)) {
    return new NextResponse(null, { status: 304, headers: CACHE_HEADERS })
  }
  return NextResponse.json(buildEmpathyArtManifest(getBaseUrl()), { headers: CACHE_HEADERS })
}
