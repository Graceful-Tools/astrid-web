/**
 * A brand's hover and ink colours, from astrid-core's rule rather than web's own (AWTD-1589).
 *
 * Web used to work these out itself: the hover was the accent darkened 15% and the inks were
 * stepped against web's own cards. iOS read a hover it was never given and fell back to
 * Astrid's blue, so Acme's purple had a blue hover there. astrid-core's `brandColors` rule
 * (astrid_rules::brand_colors, task 5ea48ab1) is now the one derivation every client uses, and
 * `cargo xtask gen-brand` writes the same answer into every client's resources.
 *
 * The rule runs in the vendored WebAssembly build (packages/astrid-rules/), which only Node
 * can load. A browser cannot, and the layout and the global error page both paint these
 * colours, so they are derived once — at build in next.config.mjs, and at container start
 * for a runtime-brand image (deploy/self-host/load-env.mjs) — and handed to the app as
 * `NEXT_PUBLIC_BRAND_ACCENT_*_COLOR`, which lib/brand/config.ts reads like any other brand
 * value.
 *
 * `.mjs` for the same reason as brand-identity-check.mjs: next.config.mjs imports it, before
 * anything is compiled. Tests: tests/brands/core-brand-colors-awtd-1589.test.ts.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** The derived colours, as the env keys lib/brand/config.ts reads, and core's name for each. */
export const DERIVED_BRAND_COLOR_ENV = {
  NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR: 'accentHover',
  NEXT_PUBLIC_BRAND_ACCENT_INK_COLOR: 'accentInk',
  NEXT_PUBLIC_BRAND_ACCENT_INK_DARK_COLOR: 'accentInkDark',
}

/**
 * astrid-core's answer for `accent`: `{ accent, accentHover, accentInk, accentInkDark,
 * accentText, winui }`. Throws with core's own reason, and `refused: true`, when it refuses the
 * accent (white cannot be read on it, or it is not `#rrggbb`); throws without it when the
 * vendored build cannot be loaded.
 */
export function coreBrandColors(accent, packageDir = join(process.cwd(), 'packages', 'astrid-rules')) {
  const require = createRequire(join(packageDir, 'node', 'package.json'))
  const { runJson } = require('./astrid_rules_wasm.js')
  const answer = JSON.parse(runJson(JSON.stringify({ kind: 'brandColors', accent })))
  if (!answer.ok) {
    const refusal = new Error(`NEXT_PUBLIC_BRAND_ACCENT_COLOR: ${answer.error?.message ?? 'refused by astrid-core'}`)
    refusal.refused = true
    throw refusal
  }
  return answer.value
}

/**
 * The derived-colour env for `env`'s accent, keeping any of the three `env` already states. Empty when no accent is set (Astrid's own: the
 * stylesheets keep their designed values). A refused accent throws, so a partner build with an
 * accent no label can be read on fails with the contrast in the message instead of shipping.
 */
export function derivedBrandColorEnv(env, packageDir) {
  const accent = env.NEXT_PUBLIC_BRAND_ACCENT_COLOR?.trim()
  if (!accent) return {}
  const colours = coreBrandColors(accent, packageDir)
  return Object.fromEntries(
    // A stated value wins, as in core's gen-brand: derivation fills only what is missing.
    Object.entries(DERIVED_BRAND_COLOR_ENV).map(([name, field]) => [name, env[name]?.trim() || colours[field]]),
  )
}
