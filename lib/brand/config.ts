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
 * Each read is `brandEnv(NAME, <literal>)`: the runtime value when the deployment
 * supplies one (one image, many brands: lib/brand/runtime-env.ts, AWTD-1587), else the
 * literal, inlined at build exactly as before.
 */

import { brandEnv } from './runtime-env'

/** Default (Astrid) values — also the fallbacks when no env is set. */
const DEFAULTS = {
  appName: 'Astrid',
  productTitle: 'Astrid Task Manager',
  tagline: 'A modern task management application for organizing your life',
  domain: 'astrid.cc',
  agentEmailDomain: 'astrid.cc',
  supportEmail: 'support@astrid.cc',
  inboundTaskEmail: 'remindme@astrid.cc',
  accentColor: '#2563eb',
  agentIdentityName: 'Astrid',
  githubAppSlug: 'astrid-code-assistant',
  wordmark: 'astrid',
  slogan: 'Get it done!',
  appStoreUrl: 'https://apps.apple.com/app/astrid-tasks/id6755752694',
  appUrlScheme: 'astrid',
  feedbackListId: '6afe098f-e163-46f7-ac4b-4f879a9314eb',
  logo: '/images/astrid-character.png',
  icon: '/icons/icon-512x512.png',
  iconSmall: '/icons/icon-96x96.png',
  defaultTheme: 'ocean',
  fontFamily: '',
  operatorName: 'Graceful Tools LLC',
} as const

/** The three stylesheets under styles/themes/. A brand picks which one it starts on. */
export const BRAND_THEMES = ['light', 'dark', 'ocean'] as const
export type BrandTheme = (typeof BRAND_THEMES)[number]

/** A theme name, or the default when the value names no stylesheet we ship. */
function themeEnv(value: string | undefined, fallback: BrandTheme): BrandTheme {
  const trimmed = value?.trim().toLowerCase()
  return (BRAND_THEMES as readonly string[]).includes(trimmed ?? '') ? (trimmed as BrandTheme) : fallback
}

/** Trim and treat an empty/whitespace-only env var as unset. */
function env(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

/** Astrid's own accent: the design tokens' `accent` (astrid-core register DS26). */
export const ASTRID_ACCENT_COLOR = DEFAULTS.accentColor

/** Astrid's own app mark. Any other `BRAND.icon` is a brand's, and lib/brand/icons.ts generates from it. */
export const ASTRID_ICON = DEFAULTS.icon

export const BRAND = {
  /** Short product name, e.g. "Astrid". Interpolated into i18n copy as `{appName}`. */
  appName: env(brandEnv('NEXT_PUBLIC_BRAND_NAME', process.env.NEXT_PUBLIC_BRAND_NAME), DEFAULTS.appName),

  /** Full product title used in <title>, OpenGraph and the PWA manifest. */
  productTitle: env(brandEnv('NEXT_PUBLIC_BRAND_TITLE', process.env.NEXT_PUBLIC_BRAND_TITLE), DEFAULTS.productTitle),

  /** One-line product description used in metadata and the manifest. */
  tagline: env(brandEnv('NEXT_PUBLIC_BRAND_TAGLINE', process.env.NEXT_PUBLIC_BRAND_TAGLINE), DEFAULTS.tagline),

  /** Apex domain, without scheme. Used for the production base-URL fallback. */
  domain: env(brandEnv('NEXT_PUBLIC_BRAND_DOMAIN', process.env.NEXT_PUBLIC_BRAND_DOMAIN), DEFAULTS.domain),

  /**
   * Domain for AI agent identities (`claude@<domain>`). Server-only: agent emails are
   * never constructed client-side. Defaults to `domain` so a fork only sets one value.
   */
  agentEmailDomain: env(
    process.env.BRAND_AGENT_EMAIL_DOMAIN,
    env(brandEnv('NEXT_PUBLIC_BRAND_DOMAIN', process.env.NEXT_PUBLIC_BRAND_DOMAIN), DEFAULTS.agentEmailDomain)
  ),

  /** Address shown to users for support requests. */
  supportEmail: env(brandEnv('NEXT_PUBLIC_BRAND_SUPPORT_EMAIL', process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL), DEFAULTS.supportEmail),

  /** Address users email to create a task. */
  inboundTaskEmail: env(
    brandEnv('NEXT_PUBLIC_BRAND_INBOUND_TASK_EMAIL', process.env.NEXT_PUBLIC_BRAND_INBOUND_TASK_EMAIL),
    DEFAULTS.inboundTaskEmail
  ),

  /** Primary accent colour — drives `themeColor` and the manifest's `theme_color`. */
  accentColor: env(brandEnv('NEXT_PUBLIC_BRAND_ACCENT_COLOR', process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR), DEFAULTS.accentColor),
  /**
   * The accent's hover and its inks (as text on a light and on a dark card), as astrid-core's
   * brandColors rule derives them from the accent — the same answer every client gets
   * (AWTD-1589). Filled at build by next.config.mjs unless a deployment states one; empty when
   * nothing derived them, and lib/brand/css-vars.ts then leaves the stylesheets on their own values.
   */
  accentHoverColor: env(brandEnv('NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR', process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR), ''),
  accentInkColor: env(brandEnv('NEXT_PUBLIC_BRAND_ACCENT_INK_COLOR', process.env.NEXT_PUBLIC_BRAND_ACCENT_INK_COLOR), ''),
  accentInkDarkColor: env(brandEnv('NEXT_PUBLIC_BRAND_ACCENT_INK_DARK_COLOR', process.env.NEXT_PUBLIC_BRAND_ACCENT_INK_DARK_COLOR), ''),

  /** Display name of the default assistant persona (may differ from `appName`). */
  agentIdentityName: env(
    brandEnv('NEXT_PUBLIC_BRAND_AGENT_NAME', process.env.NEXT_PUBLIC_BRAND_AGENT_NAME),
    env(brandEnv('NEXT_PUBLIC_BRAND_NAME', process.env.NEXT_PUBLIC_BRAND_NAME), DEFAULTS.agentIdentityName)
  ),

  /**
   * GitHub App slug backing the AI coding agent, as registered on GitHub.
   *
   * A partner registers their own App — the install URL, the generated branch prefix and
   * the private-key filename in the setup instructions all derive from it, so a
   * hardcoded slug sends their users to install someone else's App.
   */
  githubAppSlug: env(brandEnv('NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG', process.env.NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG), DEFAULTS.githubAppSlug),

  /**
   * The wordmark as drawn in the header lockup — lowercase for Astrid, which is a
   * deliberate styling choice rather than the product name.
   *
   * Defaults to the lowercased app name, so setting NEXT_PUBLIC_BRAND_NAME alone gives a
   * sensible wordmark; set this when the two should differ.
   */
  wordmark: env(
    brandEnv('NEXT_PUBLIC_BRAND_WORDMARK', process.env.NEXT_PUBLIC_BRAND_WORDMARK),
    (brandEnv('NEXT_PUBLIC_BRAND_NAME', process.env.NEXT_PUBLIC_BRAND_NAME) || DEFAULTS.appName).trim().toLowerCase()
  ),

  /** Short slogan beside the wordmark. Distinct from `tagline`, which is metadata prose. */
  slogan: env(brandEnv('NEXT_PUBLIC_BRAND_SLOGAN', process.env.NEXT_PUBLIC_BRAND_SLOGAN), DEFAULTS.slogan),

  /**
   * App Store listing. Empty string hides the download button entirely — a partner
   * without a published app should not advertise someone else's.
   */
  appStoreUrl: brandEnv('NEXT_PUBLIC_BRAND_APP_STORE_URL', process.env.NEXT_PUBLIC_BRAND_APP_STORE_URL)?.trim() ?? DEFAULTS.appStoreUrl,

  /**
   * Custom URL scheme the desktop and mobile apps register, without `://`.
   *
   * The server hands a signed-in browser back to a native app through
   * `<scheme>://auth/callback`, so a fork that ships its own apps must set this
   * or the hand-off would deep-link into someone else's application.
   */
  appUrlScheme: env(brandEnv('NEXT_PUBLIC_BRAND_APP_URL_SCHEME', process.env.NEXT_PUBLIC_BRAND_APP_URL_SCHEME), DEFAULTS.appUrlScheme),

  /**
   * The public list this deployment's Report an Issue opens in-app (AWTD-1443).
   *
   * A row in THIS deployment's database, so it is served at runtime on
   * /api/v1/capabilities rather than baked into a client. Empty string means the
   * deployment has no in-app feedback list (clients open the web instead), so blank is a
   * partner's answer here, like the App Store URL. A partner that leaves it unset
   * inherits Astrid's list, which is the bug this setting exists to prevent.
   */
  feedbackListId: brandEnv('NEXT_PUBLIC_BRAND_FEEDBACK_LIST_ID', process.env.NEXT_PUBLIC_BRAND_FEEDBACK_LIST_ID)?.trim() ?? DEFAULTS.feedbackListId,

  /**
   * Character / mascot artwork — the sign-in page, empty states and reminder popovers.
   *
   * A path, not a colour, because this is the one asset a fork cannot simply overwrite
   * in place: it ships under a brand-specific filename. The square icons below use
   * generic paths precisely so a fork CAN replace the files without touching config.
   */
  logo: env(brandEnv('NEXT_PUBLIC_BRAND_LOGO', process.env.NEXT_PUBLIC_BRAND_LOGO), DEFAULTS.logo),

  /**
   * The brand's source icon — ideally 1024 px square — that every other size is generated
   * from (lib/brand/icons.ts, AWTD-1588). A profile sets it as `assets.icon`.
   */
  icon: env(brandEnv('NEXT_PUBLIC_BRAND_ICON', process.env.NEXT_PUBLIC_BRAND_ICON), DEFAULTS.icon),

  /**
   * Small square app mark, used in page headers. Unset: Astrid's file for Astrid, and the
   * 96 px icon generated from `icon` for a brand that names its own.
   */
  iconSmall: env(
    brandEnv('NEXT_PUBLIC_BRAND_ICON_SMALL', process.env.NEXT_PUBLIC_BRAND_ICON_SMALL),
    env(brandEnv('NEXT_PUBLIC_BRAND_ICON', process.env.NEXT_PUBLIC_BRAND_ICON), DEFAULTS.icon) === DEFAULTS.icon
      ? DEFAULTS.iconSmall
      : '/brand-icon/icon-96.png'
  ),

  /**
   * The theme a visitor sees before they have picked one: `light`, `dark` or `ocean`.
   *
   * Astrid starts on ocean. A partner styled after a white-canvas product wants light,
   * and until this existed the only way to get it was to ask every user to open
   * Appearance settings. A stored choice still wins — this is the starting point, not
   * a lock. An unknown name falls back rather than breaking the theme switcher.
   */
  defaultTheme: themeEnv(brandEnv('NEXT_PUBLIC_BRAND_DEFAULT_THEME', process.env.NEXT_PUBLIC_BRAND_DEFAULT_THEME), DEFAULTS.defaultTheme),

  /**
   * A CSS `font-family` stack for the whole app. Empty keeps the bundled Inter.
   *
   * Set as an inline style on <body>, so it overrides Inter's class without
   * loading anything: a partner's stack is usually the system font, which is why it
   * is a value rather than a second `next/font` import.
   */
  fontFamily: env(brandEnv('NEXT_PUBLIC_BRAND_FONT_FAMILY', process.env.NEXT_PUBLIC_BRAND_FONT_FAMILY), DEFAULTS.fontFamily),

  /**
   * Whether the bare brand domain redirects to `www.<domain>` (middleware.ts).
   *
   * Right for an apex like astrid.cc, wrong for a brand that IS a subdomain: the partner
   * test site at tasks.gracefultools.com redirected every page to
   * www.tasks.gracefultools.com, which has no DNS, so it never opened (2026-10-04). On by
   * default so Astrid is unchanged; set NEXT_PUBLIC_BRAND_WWW_REDIRECT=false to serve the
   * domain as-is.
   */
  wwwRedirect: brandEnv('NEXT_PUBLIC_BRAND_WWW_REDIRECT', process.env.NEXT_PUBLIC_BRAND_WWW_REDIRECT)?.trim().toLowerCase() !== 'false',

  /**
   * The legal entity that operates this deployment: named in the Terms of Service, the
   * Privacy Policy and the copyright line (AWTD-1584).
   *
   * Unlike every other identity value this does NOT fall back to Astrid's once the
   * deployment is a partner's. A partner that forgot it would publish terms saying their
   * service is operated by Graceful Tools LLC, which is a legal statement about someone
   * else's company, not a cosmetic leak. So the fallback is Astrid's operator only while
   * the app is still called Astrid, and the partner's own app name after that.
   */
  operatorName: env(
    brandEnv('NEXT_PUBLIC_BRAND_OPERATOR_NAME', process.env.NEXT_PUBLIC_BRAND_OPERATOR_NAME),
    env(brandEnv('NEXT_PUBLIC_BRAND_NAME', process.env.NEXT_PUBLIC_BRAND_NAME), DEFAULTS.appName) === DEFAULTS.appName
      ? DEFAULTS.operatorName
      : env(brandEnv('NEXT_PUBLIC_BRAND_NAME', process.env.NEXT_PUBLIC_BRAND_NAME), DEFAULTS.appName)
  ),

  /**
   * The operator's own Terms of Service, when they publish one elsewhere. Empty (the
   * default) serves the built-in /terms page under `operatorName`; set, /terms redirects
   * there and every terms link points at it.
   */
  termsUrl: brandEnv('NEXT_PUBLIC_BRAND_TERMS_URL', process.env.NEXT_PUBLIC_BRAND_TERMS_URL)?.trim() ?? '',

  /** The operator's own Privacy Policy. Same rules as `termsUrl`, for /privacy. */
  privacyUrl: brandEnv('NEXT_PUBLIC_BRAND_PRIVACY_URL', process.env.NEXT_PUBLIC_BRAND_PRIVACY_URL)?.trim() ?? '',
} as const

export type Brand = typeof BRAND

/**
 * Where a link to this deployment's terms or privacy policy goes: the operator's own page
 * when the profile names one, else the built-in route.
 */
export function brandLegalHref(page: 'terms' | 'privacy'): string {
  const external = page === 'terms' ? BRAND.termsUrl : BRAND.privacyUrl
  return external || `/${page}`
}

/** Canonical production origin, e.g. `https://astrid.cc`. */
export function brandOrigin(): string {
  return `https://${BRAND.domain}`
}

/**
 * The name an MCP server announces itself under, e.g. `astrid-task-manager-oauth`.
 *
 * This string is what a user sees in Claude Desktop's server list, so it is
 * arguably the most visible identity the product has outside the app. It was
 * hardcoded, so a partner's users installed a server calling itself Astrid
 * (task 979e1325).
 *
 * Deliberately NOT frozen the way `name_for_model` and the OpenAPI path are in
 * docs/WHITELABELING.md §7: those are pinned by OpenAI's plugin contract and
 * changing them breaks existing installs. Nothing external pins the MCP server
 * name.
 *
 * Derived from the wordmark rather than the app name so it is already
 * lowercase and hyphen-safe.
 */
export function mcpServerName(variant?: string): string {
  const slug = BRAND.wordmark
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app'

  return variant ? `${slug}-task-manager-${variant}` : `${slug}-task-manager`
}

/**
 * Default API base URL for the standalone MCP servers and CLI helpers.
 *
 * They hardcoded `https://astrid.cc`, so a partner's server talked to Astrid's
 * API unless every operator remembered to set ASTRID_API_BASE_URL.
 */
export function mcpDefaultBaseUrl(): string {
  return process.env.ASTRID_API_BASE_URL?.trim() || brandOrigin()
}
