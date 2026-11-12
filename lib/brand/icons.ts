/**
 * Brand artwork from one source icon (AWTD-1588).
 *
 * Every square icon a deployment serves — the PWA manifest, the favicons, the Apple touch
 * icon, the service worker's notification icon and badge — derives from `BRAND.icon`. A
 * profile names that one file (`assets.icon`, ideally 1024 px) and every size is generated
 * from it by app/brand-icon/[file]/route.ts.
 *
 * Hosted Astrid keeps the hand-made files it has always served, at the URLs it has always
 * served them from: while `BRAND.icon` is Astrid's own, `brandIconUrl` returns the static
 * path in public/, so nothing about Astrid's icons changes, byte for byte. Before this, a
 * partner who set NEXT_PUBLIC_BRAND_ICON still got Astrid's favicons, touch icon, manifest
 * icons and notification icons, because each of those was a fixed path to Astrid's file
 * and the docs said to overwrite the files in public/icons/ — which a partner sharing
 * this repository cannot do.
 */
import { BRAND, ASTRID_ICON } from './config'

/** What an icon is for. Sizes follow from the role, except for the plain square icon. */
export type BrandIconRole =
  | { kind: 'icon'; size: number }
  | { kind: 'maskable'; size: 192 | 512 }
  | { kind: 'favicon'; size: 16 | 32 | 48 | 196 }
  | { kind: 'favicon-ico' }
  | { kind: 'apple-touch' }

/** Sizes app/brand-icon/[file]/route.ts will generate. Anything else 404s. */
export const BRAND_ICON_SIZES = [16, 32, 48, 72, 96, 128, 144, 152, 167, 180, 192, 196, 256, 384, 512] as const

/** True when the deployment names its own icon rather than Astrid's. */
export function hasCustomBrandIcon(): boolean {
  return BRAND.icon !== ASTRID_ICON
}

/** Astrid's own hand-made files in public/, exactly as they were referenced before. */
function astridIconPath(role: BrandIconRole): string {
  switch (role.kind) {
    case 'icon':
      return `/icons/icon-${role.size}x${role.size}.png`
    case 'maskable':
      return `/icons/maskable-icon-${role.size}x${role.size}.png`
    case 'favicon':
      return `/favicon-${role.size}x${role.size}.png`
    case 'favicon-ico':
      return '/favicon.ico'
    case 'apple-touch':
      return '/apple-touch-icon.png'
  }
}

/** The generated file for a role, served by app/brand-icon/[file]/route.ts. */
function generatedIconPath(role: BrandIconRole): string {
  switch (role.kind) {
    case 'icon':
    case 'favicon':
      return `/brand-icon/icon-${role.size}.png`
    case 'maskable':
      return `/brand-icon/maskable-${role.size}.png`
    case 'favicon-ico':
      // Browsers accept a PNG favicon; generating a real .ico buys nothing.
      return '/brand-icon/icon-32.png'
    case 'apple-touch':
      return '/brand-icon/apple-touch-icon.png'
  }
}

/** The URL to reference for an icon role on this deployment. */
export function brandIconUrl(role: BrandIconRole): string {
  return hasCustomBrandIcon() ? generatedIconPath(role) : astridIconPath(role)
}

/** A request for a generated icon, parsed from its file name; null for anything else. */
export type GeneratedIconRequest = { size: number; maskable: boolean; flatten: boolean }

export function parseGeneratedIconFile(file: string): GeneratedIconRequest | null {
  if (file === 'apple-touch-icon.png') return { size: 180, maskable: false, flatten: true }
  const match = /^(icon|maskable)-(\d+)\.png$/.exec(file)
  if (!match) return null
  const size = Number(match[2])
  if (!(BRAND_ICON_SIZES as readonly number[]).includes(size)) return null
  const maskable = match[1] === 'maskable'
  if (maskable && size !== 192 && size !== 512) return null
  return { size, maskable, flatten: false }
}

/**
 * For hosted Astrid, the static file a generated URL stands in for: the route serves
 * these bytes verbatim, so the service worker can name /brand-icon/* on every deployment
 * while Astrid's notifications keep the exact icon they had.
 */
export function astridFileForGenerated(request: GeneratedIconRequest): string {
  if (request.flatten) return astridIconPath({ kind: 'apple-touch' })
  if (request.maskable) return astridIconPath({ kind: 'maskable', size: request.size as 192 | 512 })
  if ([16, 32, 48, 196].includes(request.size)) {
    return astridIconPath({ kind: 'favicon', size: request.size as 16 | 32 | 48 | 196 })
  }
  return astridIconPath({ kind: 'icon', size: request.size })
}

/** The `<link rel="icon">` set for the root layout's metadata. */
export function brandMetadataIcons(): Array<{ url: string; sizes: string; type?: string }> {
  return [
    { url: brandIconUrl({ kind: 'favicon-ico' }), sizes: '32x32' },
    ...([16, 32, 48, 196] as const).map((size) => ({
      url: brandIconUrl({ kind: 'favicon', size }),
      sizes: `${size}x${size}`,
      type: 'image/png',
    })),
    ...([192, 512] as const).map((size) => ({
      url: brandIconUrl({ kind: 'icon', size }),
      sizes: `${size}x${size}`,
      type: 'image/png',
    })),
  ]
}
