/**
 * A mounted brand profile, turned into the environment the app reads (AWTD-1587).
 *
 *   docker run -v ./acme.brand.json:/brand/acme.brand.json \
 *              -e BRAND_PROFILE=/brand/acme.brand.json ghcr.io/…/astrid-web
 *
 * The same mapping lib/brand/profile.ts's `profileEnv()` applies — `env`, `assets.icon`
 * as NEXT_PUBLIC_BRAND_ICON, `copy` serialised into NEXT_PUBLIC_BRAND_COPY — written in
 * plain JavaScript because the runtime image carries no TypeScript toolchain.
 * tests/brands/runtime-brand-awtd-1587.test.ts holds the two to the same output for every
 * committed profile, so a profile mounted at runtime is applied exactly as a built one.
 *
 * The checks here are structural only. The full validation (every key against the
 * registry in lib/env.ts) is `npm run check:brands`; run it on a profile before mounting
 * it.
 */

const ENV_PREFIXES = ['NEXT_PUBLIC_BRAND_', 'BRAND_', 'AUTH_SSO_']

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @returns {Record<string, string>} */
export function brandProfileEnv(profile, source = 'brand profile') {
  if (!isRecord(profile) || !isRecord(profile.env)) {
    throw new Error(`${source}: not a brand profile (needs an "env" object)`)
  }
  const out = {}
  for (const [key, value] of Object.entries(profile.env)) {
    if (!ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
      throw new Error(`${source}: env.${key} is not a brand variable`)
    }
    if (typeof value !== 'string') throw new Error(`${source}: env.${key} must be a string`)
    out[key] = value
  }
  if (isRecord(profile.assets) && typeof profile.assets.icon === 'string') {
    out.NEXT_PUBLIC_BRAND_ICON = profile.assets.icon
  }
  if (isRecord(profile.copy)) out.NEXT_PUBLIC_BRAND_COPY = JSON.stringify(profile.copy)
  return out
}
