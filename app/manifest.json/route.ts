/**
 * PWA manifest, generated so the brand-bearing fields come from lib/brand/config.ts.
 *
 * Served at `/manifest.json` (not Next's `/manifest.webmanifest` convention) because the
 * path is already referenced by public/sw.js's precache list, lib/middleware-bypass.ts
 * and the Content-Type header rule in next.config.mjs. Keeping the URL means a fork
 * rebrands without any of those needing to change.
 *
 * Replaces the former static public/manifest.json.
 */
import { NextResponse, connection } from 'next/server'
import { BRAND } from '@/lib/brand/config'
import { brandIconUrl } from '@/lib/brand/icons'
import { isRuntimeBrandBuild } from '@/lib/brand/runtime-env'

const ICON_SIZES_MASKABLE_ANY = [72, 96, 128, 144, 152, 384]
const ICON_SIZES_ANY = [192, 256, 512]
const ICON_SIZES_MASKABLE = [192, 512] as const

export async function GET() {
  // Prerendered at build otherwise, which would freeze a runtime-brand image's manifest
  // on the build's brand (AWTD-1587). Hosted Astrid keeps the static file.
  if (isRuntimeBrandBuild()) await connection()

  const manifest = {
    name: BRAND.productTitle,
    short_name: BRAND.appName,
    description: BRAND.tagline,
    start_url: '/',
    display: 'standalone',
    background_color: '#1a1a1a',
    theme_color: BRAND.accentColor,
    orientation: 'portrait-primary',
    scope: '/',
    lang: 'en',
    categories: ['productivity', 'utilities'],
    icons: [
      ...ICON_SIZES_MASKABLE_ANY.map((size) => ({
        src: brandIconUrl({ kind: 'icon', size }),
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'maskable any',
      })),
      ...ICON_SIZES_ANY.map((size) => ({
        src: brandIconUrl({ kind: 'icon', size }),
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'any',
      })),
      ...ICON_SIZES_MASKABLE.map((size) => ({
        src: brandIconUrl({ kind: 'maskable', size }),
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'maskable',
      })),
    ],
    // No `screenshots`: it listed /screenshots/*.png, which have never existed (AWTD-1588).
    shortcuts: [
      {
        name: 'Add Task',
        short_name: 'Add Task',
        description: 'Quickly add a new task',
        url: '/?action=add-task',
        icons: [{ src: brandIconUrl({ kind: 'icon', size: 96 }), sizes: '96x96' }],
      },
      {
        name: 'My Tasks',
        short_name: 'My Tasks',
        description: 'View your personal tasks',
        url: '/?list=my-tasks',
        icons: [{ src: brandIconUrl({ kind: 'icon', size: 96 }), sizes: '96x96' }],
      },
    ],
    prefer_related_applications: false,
  }

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
