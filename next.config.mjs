import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import createNextIntlPlugin from 'next-intl/plugin'
import { turbopackRoot } from './scripts/lib/turbopack-root.mjs'
import { checkBrandIdentity } from './scripts/lib/brand-identity-check.mjs'
import { derivedBrandColorEnv } from './scripts/lib/brand-colors.mjs'

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts')

// A partner build that sets some brand identity variables but not all of them ships
// Astrid's value for the rest — support@astrid.cc, astrid://, Astrid's GitHub App. Name
// each one here, at build, or fail under BRAND_STRICT_IDENTITY=true (AWTD-1285). Hosted
// Astrid sets none of them, so for it this does nothing.
checkBrandIdentity(process.env, {
  strict: process.env.BRAND_STRICT_IDENTITY,
  acknowledged: process.env.BRAND_INHERIT_ASTRID_IDENTITY,
})

// A `/fixall` worktree shares the main checkout's node_modules by symlink, and
// Turbopack refuses to resolve through it — `Symlink [project]/node_modules is
// invalid, it points out of the filesystem root` — so the Build gate could not
// pass in any worktree, for any branch (AWTD-1240). Naming a root that contains
// both trees is the documented fix. It is `undefined` for every ordinary
// checkout, CI and Vercel, where node_modules is a real directory: the key is
// then omitted and Next infers the root as before.
//
// From this file's own location rather than process.cwd(), so the answer does
// not depend on where the build was invoked from.
const filesystemRoot = turbopackRoot(dirname(fileURLToPath(import.meta.url)))

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

// The brand's hover and inks, from astrid-core's rule so they match every other client
// (AWTD-1589; scripts/lib/brand-colors.mjs). Derived here because the browser cannot load the
// rule. A refused accent fails the build with core's reason; a missing core build only warns,
// and the stylesheets then keep their own values.
function brandColorEnv() {
  try {
    return derivedBrandColorEnv(process.env)
  } catch (error) {
    if (error.refused) throw error
    console.warn(`[brand] astrid-core's colour rule did not load, so no hover or ink is derived: ${error.message}`)
    return {}
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The deploy environment, for the browser: lib/auth-host.ts bounces Google sign-in
  // through the brand domain only on a preview build (AWTD-1469). VERCEL_ENV is set at
  // build on Vercel (scripts/lib/build-migration-policy.js relies on it); off Vercel it
  // is empty, which reads as production.
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV || '',
    ...brandColorEnv(),
  },
  ...(filesystemRoot ? { turbopack: { root: filesystemRoot } } : {}),
  // A self-contained `node server.js` for the Docker image (Dockerfile, AWTD-1286).
  // Opt-in, so a Vercel build is untouched: Vercel bundles its own way.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
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
  // /api/downloads reads these from disk at request time. Next only ships
  // files it can statically trace into a serverless function — without this
  // the read throws and the route 404s in production while working fine
  // locally. (The script used to be a stale copy in public/, which also
  // served it statically with Astrid's URL on every brand: AWTD-1281.)
  outputFileTracingIncludes: {
    '/api/downloads/[filename]': [
      'scripts/get-project-tasks-oauth.ts',
    ],
    // Generates every icon size from the brand's source icon, read from public/ at
    // request time (AWTD-1588). public/ is served statically but not traced into
    // functions, so without this the read fails and every generated icon 404s on Vercel.
    '/brand-icon/[file]': [
      'public/icons/**',
      'public/images/**',
      'public/favicon*',
      'public/apple-touch-icon.png',
    ],
    // astrid-core's rules as WebAssembly (lib/core-rules/wasm.ts). Loaded through a require
    // resolved at runtime, which tracing cannot follow, by every server function at start —
    // list permissions are decided by it everywhere (AWTD-1061) — so every function carries it
    // (~1.7 MB). Missing files are not an outage: the TypeScript rules decide, and /api/health
    // reports coreRules.loaded=false.
    '/**': [
      'packages/astrid-rules/REVISION',
      'packages/astrid-rules/node/**',
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
      // The guide moved from /starthere to /start (AWTD-1502). Links already
      // pasted into agents and chats keep working.
      { source: '/starthere', destination: '/start', permanent: true },
      { source: '/starthere.md', destination: '/start.md', permanent: true },
      { source: '/:locale/starthere', destination: '/:locale/start', permanent: true },
    ]
  },
  async rewrites() {
    return {
      afterFiles: [
        {
          source: '/mcp',
          destination: '/api/mcp',
        },
        {
          source: '/mcp/messages',
          destination: '/api/mcp/messages',
        },
        // A missing root-level file (/nope.png, /apple-touch-icon-precomposed.png,
        // /nope.md) is a 404, not the app (AWTD-1599). The middleware cannot say
        // so: its matcher skips file-shaped addresses so it does not run on every
        // static request, and it runs before the filesystem, so it could not tell
        // a missing file from a real one anyway. This list is the afterFiles
        // phase: it runs only after public/ and the static routes (/llms.txt,
        // /start.md, /manifest.json) found nothing, and before dynamic routes —
        // where `[locale]` would otherwise take "nope.png" as a locale and render
        // the app shell with a 200. A segment with a dot is never a locale.
        // The destination is the localized 404 handler (app/missing/[locale]),
        // in the default locale: a file has no language.
        {
          source: '/:file([^/]*\\.[^/]*)',
          destination: '/missing/en',
        },
      ],
      // A miss under a locale (/de/zz, /fr/list/x/y) gets the 404 in that
      // locale. Fallback runs only after every page and dynamic route missed.
      // On Vercel, a miss that gets past this is answered from the prerendered
      // /404 without running a function, and that page cannot know the locale
      // (AWTD-1599). The handler takes the first segment and falls back to the
      // default locale for anything that is not one. /api and /_next keep
      // Next's own 404.
      fallback: [
        {
          source: '/:locale((?!(?:api|_next)/)[^/.]+)/:path+',
          destination: '/missing/:locale',
        },
      ],
    }
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
