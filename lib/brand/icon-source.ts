/**
 * Where a brand's source icon may live (AWTD-1588).
 *
 * app/brand-icon/[file]/route.ts reads the source from disk, so it must be a PNG path,
 * not a URL, and it must sit where the deployed function can see it:
 *   - `public/icons/` or `public/images/`, the two directories next.config.mjs traces
 *     into that function (any other public/ directory would work locally and 404 on
 *     Vercel);
 *   - `/brand-assets/`, a self-hosted image's mounted BRAND_ASSETS_DIR.
 *
 * Shared by the profile's `assets.icon` and the environment registry's validator for
 * NEXT_PUBLIC_BRAND_ICON, so the two ways of setting it cannot accept different things.
 * No imports: lib/env.ts loads this.
 */
export const BRAND_ICON_SOURCE_DIRS = ['/icons/', '/images/', '/brand-assets/'] as const

/** The problem with a source icon path, or null when it is usable. */
export function brandIconSourceProblem(value: string): string | null {
  const ok =
    /^\/[A-Za-z0-9._/-]+\.png$/.test(value) &&
    !value.includes('..') &&
    BRAND_ICON_SOURCE_DIRS.some((dir) => value.startsWith(dir))
  return ok ? null : `Must be a .png path under ${BRAND_ICON_SOURCE_DIRS.join(', ')} (e.g. /icons/acme-1024.png), not a URL`
}
