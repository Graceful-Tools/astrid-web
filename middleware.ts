import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import createMiddleware from 'next-intl/middleware'
import { routing } from '@/lib/i18n/routing'

// Create next-intl middleware
const intlMiddleware = createMiddleware(routing)

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || ""
  const pathname = request.nextUrl.pathname

  // Redirect naked domain (astrid.cc) to www.astrid.cc
  // EXCEPT for:
  // - .well-known paths (needed for iOS passkeys/AASA)
  // - /api routes (iOS app uses astrid.cc directly for API calls)
  if (
    host === "astrid.cc" &&
    !pathname.startsWith("/.well-known") &&
    !pathname.startsWith("/api")
  ) {
    const url = request.nextUrl.clone()
    url.host = "www.astrid.cc"
    // Use 308 to preserve HTTP method (301 converts POST to GET)
    return NextResponse.redirect(url, 308)
  }

  // Skip i18n for API routes, .well-known, and static PWA files
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/.well-known') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.json'
  ) {
    return NextResponse.next()
  }

  // Apply i18n middleware for all other routes
  return intlMiddleware(request)
}

export const config = {
  // Run on all paths except static files
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, favicon-*.png (favicon files)
     * - apple-touch-icon*.png, apple-icon*.png (Apple icons)
     * - public folder files (icons, images, screenshots, etc.)
     * - sw.js (service worker)
     * - manifest.json (PWA manifest)
     * - Static asset extensions (.png, .jpg, .ico, .svg, .webp)
     */
    "/((?!_next/static|_next/image|favicon|apple-touch-icon|apple-icon|icons/|images/|screenshots/|sounds/|sw\\.js|manifest\\.json|.*\\.png$|.*\\.ico$|.*\\.svg$|.*\\.jpg$|.*\\.webp$|.*\\.wav$).*)",
  ],
}
