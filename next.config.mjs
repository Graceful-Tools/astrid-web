import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts')

// Content Security Policy configuration
// See https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
// Note: upgrade-insecure-requests only in production (breaks Safari localhost)
const isProduction = process.env.NODE_ENV === 'production'
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' ${isProduction ? '' : "'unsafe-eval'"} https://va.vercel-scripts.com https://vercel.live https://us-assets.i.posthog.com https://*.posthog.com https://static.cloudflareinsights.com https://unpkg.com;
  worker-src 'self' blob:;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: blob: https://lh3.googleusercontent.com https://images.unsplash.com https://*.vercel-storage.com https://*.public.blob.vercel-storage.com https://uvq3rbgqrtvvavdq.public.blob.vercel-storage.com;
  connect-src 'self' https://vitals.vercel-insights.com https://*.vercel-insights.com https://vercel.live wss://ws-us3.pusher.com https://sockjs-us3.pusher.com https://oauth2.googleapis.com https://people.googleapis.com https://*.vercel-storage.com https://*.public.blob.vercel-storage.com https://us.i.posthog.com https://*.posthog.com https://lh3.googleusercontent.com;
  frame-src 'self' https://accounts.google.com https://appleid.apple.com https://vercel.live;
  frame-ancestors 'self';
  form-action 'self';
  base-uri 'self';
  object-src 'none';
  ${isProduction ? 'upgrade-insecure-requests;' : ''}
`.replace(/\s{2,}/g, ' ').trim()

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 removed the `eslint` config key along with `next lint`; linting is its own
  // step (`npm run lint`) and the quality gates run it separately, so nothing is lost by
  // dropping it. Keeping it made the whole config invalid.
  typescript: {
    ignoreBuildErrors: process.env.NODE_ENV === 'production',
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
      'public/ASTRID_WORKFLOW.md',
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
      {
        key: 'Content-Security-Policy',
        value: ContentSecurityPolicy,
      },
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
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: process.env.NODE_ENV === 'production' ? 'https://astrid.cc' : 'http://localhost:3000' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-OAuth-Token, X-API-Version, X-Internal-Secret, X-Platform' },
        ],
      },
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
