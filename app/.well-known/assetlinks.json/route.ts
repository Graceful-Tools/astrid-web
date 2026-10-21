import { androidAssetLinks } from '@/lib/brand/android-asset-links'

/**
 * Android verified app links for this deployment's own apps (AWTD-1303). A route rather
 * than a file in public/ so a partner domain does not claim Astrid's app. Android
 * requires `application/json` and no redirect, and middleware skips /.well-known.
 * No apps configured is a 404, not an empty list.
 */
export function GET() {
  const body = androidAssetLinks()
  if (body === null) return new Response(null, { status: 404 })
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
