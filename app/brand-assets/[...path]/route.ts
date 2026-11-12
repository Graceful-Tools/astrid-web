/**
 * A partner's artwork from a mounted directory, so the published image needs no rebuild
 * to carry it (AWTD-1587). `/brand-assets/acme-logo.png` is `$BRAND_ASSETS_DIR/acme-logo.png`.
 *
 * A profile points at these paths like any other: `NEXT_PUBLIC_BRAND_LOGO` set to
 * `/brand-assets/acme-logo.png`, `assets.icon` to `/brand-assets/acme-1024.png` (every
 * icon size is then generated from it by /brand-icon). Unset BRAND_ASSETS_DIR, or a
 * file that is not an image, is a 404.
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { NextResponse } from 'next/server'
import { BRAND_ASSET_TYPES, BRAND_ASSETS_PREFIX, brandAssetFile } from '@/lib/brand/asset-files'

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const relative = path.join('/')
  const type = BRAND_ASSET_TYPES[extname(relative).toLowerCase()]
  const file = type ? brandAssetFile(`${BRAND_ASSETS_PREFIX}${relative}`) : null
  if (!file) return new NextResponse('Not found', { status: 404 })

  try {
    const body = await readFile(file)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
        // An SVG served from an operator's directory must not run script in our origin.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
