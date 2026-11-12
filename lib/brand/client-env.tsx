import Script from 'next/script'
import { ENV_VARS } from '@/lib/env'
import { BRAND_ENV_GLOBAL, brandEnv } from './runtime-env'

/**
 * The client-safe brand values, as this server resolves them at runtime (AWTD-1587).
 *
 * Only `NEXT_PUBLIC_BRAND_*`: those are public by definition (Next would have inlined
 * them into every bundle anyway). Server-only `BRAND_*` values — agent domains, app ids,
 * SSO secrets — never reach the page. A blank value is kept, because blank is a
 * partner's answer for some keys (an empty App Store URL hides the button).
 */
export function clientBrandEnv(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const { name } of ENV_VARS) {
    if (!name.startsWith('NEXT_PUBLIC_BRAND_')) continue
    const value = brandEnv(name, undefined)
    if (value !== undefined) values[name] = value
  }
  return values
}

/** JSON that is safe inside a <script>: no `</script>`, no HTML comment openers. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Writes `window.__ASTRID_BRAND_ENV__` before any app code runs, so every client module
 * that reads `BRAND` sees this deployment's brand rather than the build's.
 * `beforeInteractive` is Next's guarantee of exactly that ordering.
 */
export function BrandEnvScript() {
  return (
    // The rule predates the app router: there, beforeInteractive belongs in the root
    // layout, which is the only place this renders.
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
    <Script
      id="astrid-brand-env"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: `self.${BRAND_ENV_GLOBAL}=${scriptSafeJson(clientBrandEnv())}` }}
    />
  )
}
