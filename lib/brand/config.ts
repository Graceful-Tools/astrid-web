/**
 * Brand configuration — the single source of truth for every brand-bearing value.
 *
 * A fork rebrands the app by setting the `NEXT_PUBLIC_BRAND_*` environment variables
 * (and swapping the assets in `public/`). No source file should contain the literal
 * "Astrid" or "astrid.cc" outside this directory; `npm run check:reuse` enforces that.
 *
 * Every field falls back to the current Astrid value, so behaviour is unchanged when
 * nothing is configured.
 *
 * NOTE: `process.env.NEXT_PUBLIC_*` must be referenced *literally* for Next.js to inline
 * it into the client bundle — do not refactor these into a loop or a computed key.
 */

/** Default (Astrid) values — also the fallbacks when no env is set. */
const DEFAULTS = {
  appName: 'Astrid',
  productTitle: 'Astrid Task Manager',
  tagline: 'A modern task management application for organizing your life',
  domain: 'astrid.cc',
  agentEmailDomain: 'astrid.cc',
  supportEmail: 'support@astrid.cc',
  inboundTaskEmail: 'remindme@astrid.cc',
  accentColor: '#3b82f6',
  agentIdentityName: 'Astrid',
  githubAppSlug: 'astrid-code-assistant',
  wordmark: 'astrid',
  slogan: 'Get it done!',
  appStoreUrl: 'https://apps.apple.com/app/astrid-tasks/id6755752694',
  logo: '/images/astrid-character.png',
  icon: '/icons/icon-512x512.png',
  iconSmall: '/icons/icon-96x96.png',
} as const

/** Trim and treat an empty/whitespace-only env var as unset. */
function env(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

export const BRAND = {
  /** Short product name, e.g. "Astrid". Interpolated into i18n copy as `{appName}`. */
  appName: env(process.env.NEXT_PUBLIC_BRAND_NAME, DEFAULTS.appName),

  /** Full product title used in <title>, OpenGraph and the PWA manifest. */
  productTitle: env(process.env.NEXT_PUBLIC_BRAND_TITLE, DEFAULTS.productTitle),

  /** One-line product description used in metadata and the manifest. */
  tagline: env(process.env.NEXT_PUBLIC_BRAND_TAGLINE, DEFAULTS.tagline),

  /** Apex domain, without scheme. Used for the production base-URL fallback. */
  domain: env(process.env.NEXT_PUBLIC_BRAND_DOMAIN, DEFAULTS.domain),

  /**
   * Domain for AI agent identities (`claude@<domain>`). Server-only: agent emails are
   * never constructed client-side. Defaults to `domain` so a fork only sets one value.
   */
  agentEmailDomain: env(
    process.env.BRAND_AGENT_EMAIL_DOMAIN,
    env(process.env.NEXT_PUBLIC_BRAND_DOMAIN, DEFAULTS.agentEmailDomain)
  ),

  /** Address shown to users for support requests. */
  supportEmail: env(process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL, DEFAULTS.supportEmail),

  /** Address users email to create a task. */
  inboundTaskEmail: env(
    process.env.NEXT_PUBLIC_BRAND_INBOUND_TASK_EMAIL,
    DEFAULTS.inboundTaskEmail
  ),

  /** Primary accent colour — drives `themeColor` and the manifest's `theme_color`. */
  accentColor: env(process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR, DEFAULTS.accentColor),

  /** Display name of the default assistant persona (may differ from `appName`). */
  agentIdentityName: env(
    process.env.NEXT_PUBLIC_BRAND_AGENT_NAME,
    env(process.env.NEXT_PUBLIC_BRAND_NAME, DEFAULTS.agentIdentityName)
  ),

  /**
   * GitHub App slug backing the AI coding agent, as registered on GitHub.
   *
   * A partner registers their own App — the install URL, the generated branch prefix and
   * the private-key filename in the setup instructions all derive from it, so a
   * hardcoded slug sends their users to install someone else's App.
   */
  githubAppSlug: env(process.env.NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG, DEFAULTS.githubAppSlug),

  /**
   * The wordmark as drawn in the header lockup — lowercase for Astrid, which is a
   * deliberate styling choice rather than the product name.
   *
   * Defaults to the lowercased app name, so setting NEXT_PUBLIC_BRAND_NAME alone gives a
   * sensible wordmark; set this when the two should differ.
   */
  wordmark: env(
    process.env.NEXT_PUBLIC_BRAND_WORDMARK,
    (process.env.NEXT_PUBLIC_BRAND_NAME || DEFAULTS.appName).trim().toLowerCase()
  ),

  /** Short slogan beside the wordmark. Distinct from `tagline`, which is metadata prose. */
  slogan: env(process.env.NEXT_PUBLIC_BRAND_SLOGAN, DEFAULTS.slogan),

  /**
   * App Store listing. Empty string hides the download button entirely — a partner
   * without a published app should not advertise someone else's.
   */
  appStoreUrl: process.env.NEXT_PUBLIC_BRAND_APP_STORE_URL?.trim() ?? DEFAULTS.appStoreUrl,

  /**
   * Character / mascot artwork — the sign-in page, empty states and reminder popovers.
   *
   * A path, not a colour, because this is the one asset a fork cannot simply overwrite
   * in place: it ships under a brand-specific filename. The square icons below use
   * generic paths precisely so a fork CAN replace the files without touching config.
   */
  logo: env(process.env.NEXT_PUBLIC_BRAND_LOGO, DEFAULTS.logo),

  /** Large square app mark. Generic path — a fork replaces public/icons/*. */
  icon: env(process.env.NEXT_PUBLIC_BRAND_ICON, DEFAULTS.icon),

  /** Small square app mark, used in page headers. */
  iconSmall: env(process.env.NEXT_PUBLIC_BRAND_ICON_SMALL, DEFAULTS.iconSmall),
} as const

export type Brand = typeof BRAND

/** Canonical production origin, e.g. `https://astrid.cc`. */
export function brandOrigin(): string {
  return `https://${BRAND.domain}`
}
