/**
 * Which brand identity a partner build is still taking from Astrid (AWTD-1285).
 *
 * Every value in lib/brand/config.ts falls back to Astrid's, which is what keeps hosted
 * Astrid unchanged with no configuration at all. The cost is that a partner who sets
 * NEXT_PUBLIC_BRAND_NAME and forgets the support email ships `support@astrid.cc`, and
 * nothing says so: only that partner's own `forbidLiterals` would catch it, and only if
 * they wrote one.
 *
 * So once ANY identity variable is set — the build is a partner's — each one still unset
 * is named at build time. A partner who keeps one of Astrid's values on purpose (the
 * Graceful Tools test sites keep Astrid's GitHub App) lists it in
 * BRAND_INHERIT_ASTRID_IDENTITY; BRAND_STRICT_IDENTITY=true turns the warning into a
 * failed build. Astrid sets none of these, so for Astrid the check never runs.
 *
 * Derived values are not listed: the agent name and wordmark follow the brand name, and
 * the agent email domain follows the domain, so they are covered by the variable they
 * derive from.
 *
 * This is `.mjs` rather than TypeScript because `next.config.mjs` imports it, and the
 * config is loaded before anything is compiled (see scripts/lib/turbopack-root.mjs).
 * Its tests are in tests/brands/brand-matrix.test.ts.
 */

/** Identity variables whose unset value is Astrid's own, in lib/brand/config.ts order. */
export const BRAND_IDENTITY_ENV = [
  'NEXT_PUBLIC_BRAND_NAME',
  'NEXT_PUBLIC_BRAND_TITLE',
  'NEXT_PUBLIC_BRAND_TAGLINE',
  'NEXT_PUBLIC_BRAND_DOMAIN',
  'NEXT_PUBLIC_BRAND_SUPPORT_EMAIL',
  'NEXT_PUBLIC_BRAND_INBOUND_TASK_EMAIL',
  'NEXT_PUBLIC_BRAND_SLOGAN',
  'NEXT_PUBLIC_BRAND_LOGO',
  'NEXT_PUBLIC_BRAND_APP_STORE_URL',
  'NEXT_PUBLIC_BRAND_APP_URL_SCHEME',
  'NEXT_PUBLIC_BRAND_FEEDBACK_LIST_ID',
  'NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG',
]

/**
 * An empty App Store URL hides the download button (config.ts reads it with `??`), so
 * blank is a partner's answer there. Everywhere else blank falls back, like unset.
 */
const BLANK_IS_A_VALUE = new Set([
  'NEXT_PUBLIC_BRAND_APP_STORE_URL',
  // Blank means "no in-app feedback list" (AWTD-1443).
  'NEXT_PUBLIC_BRAND_FEEDBACK_LIST_ID',
])

function isSet(env, name) {
  const value = env[name]
  if (value === undefined) return false
  return BLANK_IS_A_VALUE.has(name) || value.trim() !== ''
}

function listEnv(value) {
  return new Set((value ?? '').split(',').map((s) => s.trim()).filter(Boolean))
}

/**
 * The identity variables this build leaves on Astrid's value and has not acknowledged
 * (`acknowledged` is BRAND_INHERIT_ASTRID_IDENTITY). Empty for Astrid itself, which sets
 * none of them.
 */
export function inheritedAstridIdentity(env, acknowledged) {
  if (!BRAND_IDENTITY_ENV.some((name) => isSet(env, name))) return []
  const kept = listEnv(acknowledged)
  return BRAND_IDENTITY_ENV.filter((name) => !isSet(env, name) && !kept.has(name))
}

/**
 * Warn about each inherited identity variable, or throw when `strict` is "true".
 * Called from next.config.mjs, so it runs on every build. The two switches arrive as
 * options rather than being read off `env` so the config reads them by name, which is
 * what scripts/check-env-schema.ts looks for.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ strict?: string, acknowledged?: string, warn?: (message: string) => void }} [options]
 */
export function checkBrandIdentity(env, { strict, acknowledged, warn = console.warn } = {}) {
  const inherited = inheritedAstridIdentity(env, acknowledged)
  if (inherited.length === 0) return

  const message =
    `Brand configuration leaves ${inherited.length} identity variable(s) unset, so this build ` +
    `ships Astrid's value for each:\n${inherited.map((name) => `  - ${name}`).join('\n')}\n` +
    'Set them, or list the ones you mean to keep in BRAND_INHERIT_ASTRID_IDENTITY ' +
    '(docs/WHITELABELING.md).'

  if (strict?.trim().toLowerCase() === 'true') {
    throw new Error(`${message}\nBRAND_STRICT_IDENTITY=true refuses to build with them.`)
  }
  warn(`\n⚠️  ${message}\n   Set BRAND_STRICT_IDENTITY=true to fail the build instead.\n`)
}
