/**
 * What version of the iOS and Mac apps is actually RELEASED, for the Update
 * card the clients already ship (AWTD-920, iOS AITD-383).
 *
 * THE SOURCE HAS TO BE THE STORE, NOT THE BUILD. The honest answer is whatever
 * is downloadable from the App Store right now — which is NOT the iOS repo's
 * `CURRENT_PROJECT_VERSION` and not the Xcode Cloud run number. Internal
 * TestFlight builds routinely run ahead of the store, and a client that
 * compared against those would tell Jon to downgrade.
 *
 * A HAND-MAINTAINED TABLE IS THE POINT, not a shortcut. It changes a few times
 * a year, it belongs in a diff someone can review, and a release can update it.
 * The alternative — deriving it from something automatic — would be wrong in
 * the one direction that nags every user on every launch.
 *
 * IT IS EMPTY ON PURPOSE. The clients treat any failure, and any response
 * without `latestVersion`/`updateUrl`, as "no update known" and show nothing.
 * So an empty table is a working, invisible feature rather than a broken one,
 * and the endpoint can land before anyone has decided what goes in it. Filling
 * it in is what turns the card on.
 *
 * THE TWO PLATFORMS VERSION INDEPENDENTLY. They ship separately, so they get
 * separate rows and the endpoint refuses to answer without knowing which one
 * is asking. Returning one number for both would nag whichever app is behind.
 */

/** The apps that have their own release cadence, and so their own row. */
export const APP_PLATFORMS = ['ios', 'mac'] as const

export type AppPlatform = (typeof APP_PLATFORMS)[number]

export interface AppVersionInfo {
  /** The released store version. Nothing happens on the client without it. */
  latestVersion?: string
  /** Reserved: the client decodes it but does not use it yet. */
  minimumVersion?: string
  /** REQUIRED for the card to appear — the client will not offer an update it cannot send anyone to. */
  updateUrl?: string
  /** Shown if present. */
  releaseNotes?: string
}

/**
 * The schemes the clients will actually open, mirrored from their side.
 *
 * The value ends up in `openURL`, so "open whatever the server said" is not
 * something to hand a client — and the server should not be emitting one it
 * knows will be refused either. Checked here so a bad entry in the table below
 * fails in tests rather than silently producing a card that does nothing.
 */
export const ALLOWED_UPDATE_URL_SCHEMES = ['https:', 'http:', 'macappstore:', 'itms-apps:'] as const

/**
 * THE TABLE. Update this when a release actually reaches the store.
 *
 * Empty means "no update known", which is the safe, invisible state. To turn
 * the Update card on, a row needs BOTH `latestVersion` and a real `updateUrl`
 * — there is no App Store id recorded anywhere in the iOS repo yet, and a
 * link nobody has verified is worse than no card at all.
 */
export const RELEASED_APP_VERSIONS: Readonly<Record<AppPlatform, AppVersionInfo>> = {
  ios: {},
  mac: {},
}

/** Is this a platform we publish? Used to reject rather than guess. */
export function parseAppPlatform(value: string | null | undefined): AppPlatform | null {
  if (!value) return null
  return (APP_PLATFORMS as readonly string[]).includes(value) ? (value as AppPlatform) : null
}

/** Does the client stand any chance of opening this? */
export function isAllowedUpdateUrl(url: string): boolean {
  try {
    return (ALLOWED_UPDATE_URL_SCHEMES as readonly string[]).includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * The row for one platform, with absent fields OMITTED rather than sent as
 * null, and an unopenable `updateUrl` dropped.
 *
 * Dropping rather than passing it through is deliberate: with no `updateUrl`
 * the client shows no card, which is the outcome we want from a bad value. The
 * alternative is a card whose button does nothing.
 */
export function appVersionFor(platform: AppPlatform): AppVersionInfo {
  return shapeAppVersionInfo(RELEASED_APP_VERSIONS[platform])
}

/**
 * The shaping, separated from the lookup so it can be tested against rows the
 * table does not contain.
 *
 * The table ships EMPTY, so every assertion about dropping a bad `updateUrl`
 * or omitting an absent field would be vacuous if it could only be made
 * through `appVersionFor`. This is the seam that lets those be real tests.
 */
export function shapeAppVersionInfo(configured: AppVersionInfo): AppVersionInfo {
  const info: AppVersionInfo = {}

  if (configured.latestVersion) info.latestVersion = configured.latestVersion
  if (configured.minimumVersion) info.minimumVersion = configured.minimumVersion
  if (configured.updateUrl && isAllowedUpdateUrl(configured.updateUrl)) {
    info.updateUrl = configured.updateUrl
  }
  if (configured.releaseNotes) info.releaseNotes = configured.releaseNotes

  return info
}
