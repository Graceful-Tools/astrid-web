import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { getEffectiveFeatures } from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await getUnifiedSession(request)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const effective = await getEffectiveFeatures(session.user.id)
  const etag = `"features-${effective.version}-${Object.values(effective.features).map(Number).join('')}"`
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } })
  }
  return NextResponse.json(effective, {
    headers: {
      ETag: etag,
      'Cache-Control': 'private, no-cache',
    },
  })
}
