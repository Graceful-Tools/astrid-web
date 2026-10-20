import { appleAppSiteAssociation } from '@/lib/brand/apple-app-site-association'

/**
 * Passkeys and universal links for this deployment's own apps (AWTD-1281). A route
 * rather than a file in public/ so a partner domain does not claim Astrid's apps.
 * Apple requires `application/json` and no redirect, and middleware skips /.well-known.
 */
export function GET() {
  return new Response(appleAppSiteAssociation(), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
