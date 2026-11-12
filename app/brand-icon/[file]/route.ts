/**
 * Every icon size, generated from the brand's one source icon (AWTD-1588).
 *
 * `/brand-icon/icon-<size>.png`, `/brand-icon/maskable-<192|512>.png` and
 * `/brand-icon/apple-touch-icon.png`. lib/brand/icons.ts decides which URLs the manifest,
 * the layout and the service worker reference.
 *
 * For hosted Astrid (no custom icon) this serves the existing hand-made file for the size,
 * byte for byte, so the service worker can name these URLs on every deployment without
 * changing a single Astrid icon.
 *
 * The source is read from public/ at request time, so next.config.mjs's
 * outputFileTracingIncludes ships public/icons and public/images with this function.
 * sharp is loaded lazily: if it cannot load (it is an optional dependency), the source is
 * served unresized and the browser scales it, which is a worse icon, not a missing one.
 */
import { readFile } from 'node:fs/promises'
import { NextResponse } from 'next/server'
import { BRAND } from '@/lib/brand/config'
import { astridFileForGenerated, hasCustomBrandIcon, parseGeneratedIconFile } from '@/lib/brand/icons'
import { brandAssetFile } from '@/lib/brand/asset-files'

function png(body: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/png',
      // A deployment's brand is fixed for its lifetime; a day keeps a profile change cheap.
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const request = parseGeneratedIconFile(file)
  if (!request) return new NextResponse('Not found', { status: 404 })

  // public/, or BRAND_ASSETS_DIR for a /brand-assets/ icon mounted beside the profile.
  const sourcePath = brandAssetFile(hasCustomBrandIcon() ? BRAND.icon : astridFileForGenerated(request))
  if (!sourcePath) return new NextResponse('Not found', { status: 404 })

  let source: Buffer
  try {
    source = await readFile(sourcePath)
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }

  if (!hasCustomBrandIcon()) return png(source)

  try {
    const { default: sharp } = await import('sharp')
    const { size } = request
    if (request.maskable) {
      // Maskable icons are cropped to a circle by some launchers: keep the mark inside the
      // central 80% safe zone, on the brand colour.
      const inner = Math.round(size * 0.8)
      const mark = await sharp(source).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
      const pad = Math.floor((size - inner) / 2)
      return png(await sharp({ create: { width: size, height: size, channels: 4, background: BRAND.accentColor } })
        .composite([{ input: mark, left: pad, top: pad }]).png().toBuffer())
    }
    // Already the size asked for: serve the brand's own file untouched, not a re-encode.
    const meta = await sharp(source).metadata()
    if (!request.flatten && meta.width === size && meta.height === size) return png(source)
    let image = sharp(source).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    // iOS paints a transparent touch icon on black.
    if (request.flatten) image = image.flatten({ background: { r: 255, g: 255, b: 255 } })
    return png(await image.png().toBuffer())
  } catch {
    return png(source)
  }
}
