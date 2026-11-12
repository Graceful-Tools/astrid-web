/**
 * Where a brand asset URL lives on disk (AWTD-1587).
 *
 * `/brand-assets/<file>` is a file in `BRAND_ASSETS_DIR`, a directory the operator mounts
 * into the container beside the profile, served by app/brand-assets/[...path]/route.ts.
 * That is how the published image carries a partner's artwork without anyone writing into
 * `public/`, which is baked into the image. Any other path is a file in `public/`.
 *
 * Server-only: it reads the filesystem.
 */
import { join, normalize, sep } from 'node:path'

export const BRAND_ASSETS_PREFIX = '/brand-assets/'

/** A path under `dir`, refusing anything that climbs out of it. */
function within(dir: string, relative: string): string | null {
  const base = normalize(dir)
  const resolved = normalize(join(base, relative))
  return resolved.startsWith(base.endsWith(sep) ? base : base + sep) ? resolved : null
}

/** The file a brand asset URL path names, or null when it names nothing servable. */
export function brandAssetFile(urlPath: string): string | null {
  if (urlPath.startsWith(BRAND_ASSETS_PREFIX)) {
    const dir = process.env.BRAND_ASSETS_DIR?.trim()
    return dir ? within(dir, urlPath.slice(BRAND_ASSETS_PREFIX.length)) : null
  }
  return within(join(process.cwd(), 'public'), urlPath)
}

/** Image types an asset may be. Anything else is not served. */
export const BRAND_ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}
