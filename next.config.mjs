import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts')

// NOTE: the Content Security Policy is NOT here.
//
// It used to be a static header carrying `'unsafe-inline'` in script-src, which
// defeats the point — that directive permits exactly the injected script a CSP
// exists to stop — and it allowed https://unpkg.com because the service worker
// pulled Dexie from there. A nonce cannot be a static value, so the policy is
// built per request in lib/csp.ts and applied in middleware.ts. Do not restore
// it here: a static header would win over the middleware's and silently
// reintroduce 'unsafe-inline'. (Task eea00b1b.)
const isProduction = process.env.NODE_ENV === 'production'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 removed the `eslint` config key along with `next lint`; linting is its own
  // step (`npm run lint`) and the quality gates run it separately, so nothing is lost by
  // dropping it. Keeping it made the whole config invalid.
  typescript: {
    // The build that SHIPS used to be the one that skipped type checking:
    // ignoreBuildErrors was true exactly when NODE_ENV was production, so
    // predeploy was the only gate and anything that reached the deploy
    // workflow another way went out unchecked (task eea00b1b).
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: process.env.NODE_ENV === 'development',
    // `images.domains` is removed in Next 16 in favour of `remotePatterns`, which pins the
    // scheme and path rather than trusting every URL on the host.
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  serverExternalPackages: ['@prisma/client', 'pino', 'pino-pretty', 'thread-stream'],
  // /api/downloads reads these out of public/ at request time. Next only ships
  // files it can statically trace into a serverless function, and public/ is
  // served by the CDN rather than bundled — without this the read throws and
  // the route 404s in production while working fine locally.
  outputFileTracingIncludes: {
    '/api/downloads/[filename]': [
      'public/get-project-tasks-oauth.ts',
    ],
  },
  async redirects() {
    return [
      {
        source: '/mcp-operations',
        destination: '/settings/mcp-operations',
        permanent: true,
      },
      {
        source: '/mcp-testing',
        destination: '/settings/mcp-testing',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/mcp',
        destination: '/api/mcp',
      },
      {
        source: '/mcp/messages',
        destination: '/api/mcp/messages',
      },
    ]
  },
  async headers() {
    // Security headers applied to all routes
    const securityHeaders = [
      // Only apply HSTS in production - it breaks Safari on localhost
      ...(process.env.NODE_ENV === 'production' ? [{
        // HSTS: Force HTTPS for 1 year, include subdomains
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      }] : []),
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'X-Frame-Options',
        value: 'SAMEORIGIN',
      },
      {
        key: 'X-XSS-Protection',
        value: '1; mode=block',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ]

    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: securityHeaders,
      },
      // NOTE: /api CORS is NOT here. Static headers cannot vary by request, so
      // this block sent `Access-Control-Allow-Origin: https://astrid.cc` with
      // `Allow-Credentials: true` on every deployment — a partner's API
      // granting credentialed cross-origin access to somebody else's domain —
      // and no `Vary: Origin`. It now lives in middleware.ts via lib/cors.ts,
      // where the request Origin is available. Do not restore it: a static
      // header here would win over the middleware's. (Task 229c175c.)
      {
        source: '/manifest.json',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript' },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/icons/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Apple App Site Association file for passkeys and universal links
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
