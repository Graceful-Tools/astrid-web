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
 * AN EMPTY ROW IS STILL A WORKING STATE. The clients treat any failure, and
 * any response without `latestVersion`/`updateUrl`, as "no update known" and
 * show nothing. That is how the endpoint shipped ahead of the numbers
 * (AWTD-920); filling the table in is what turned the card on (AWTD-924). If a
 * future platform has no released build yet, leaving its row `{}` is correct
 * rather than pending.
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
 * The App Store listing both apps ship under.
 *
 * ONE listing serves both platforms — `supportedDevices` for id 6755752694
 * includes `MacDesktop-MacDesktop` alongside the iPhone and iPad entries — so
 * the same URL appearing twice below is correct, not a copy-paste slip.
 *
 * Verified against the iTunes lookup API before it was committed (AWTD-924):
 * trackName `Astrid Tasks`, sellerName `Graceful Tools LLC`, bundleId
 * `Graceful-Tools-Inc.Astrid-App`. The module's whole caution is that an
 * unverified `apps.apple.com/app/id…` nags every user on every launch, so the
 * id is checked rather than assumed.
 */
const APP_STORE_URL = 'https://apps.apple.com/us/app/astrid-tasks/id6755752694'

/**
 * THE TABLE. Update this when a release actually reaches the store.
 *
 * Empty means "no update known", which is the safe, invisible state. A row
 * needs BOTH `latestVersion` and a real `updateUrl` to show anything.
 *
 * THE NUMBERS COME FROM APP STORE CONNECT, not from a build. Jon read these
 * off the store on 2026-09-14 (AWTD-924). The lookup API independently
 * confirms 1.9.2 for the listing; it reports a SINGLE version for the unified
 * listing, so it cannot corroborate the Mac number — 1.1.1 is Jon's value from
 * App Store Connect.
 *
 * That asymmetry is the safe direction. If the Mac app reports a HIGHER
 * version than the number here, the client simply shows no card: a stale-low
 * value is silent, where a stale-high one would nag every launch. So if Mac
 * users never see an update card, suspect this row before suspecting the
 * endpoint.
 */
export const RELEASED_APP_VERSIONS: Readonly<Record<AppPlatform, AppVersionInfo>> = {
  ios: { latestVersion: '1.9.2', updateUrl: APP_STORE_URL },
  mac: { latestVersion: '1.1.1', updateUrl: APP_STORE_URL },
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
 * Every assertion about dropping a bad `updateUrl` or omitting an absent field
 * would be vacuous if it could only be made through `appVersionFor`, whose
 * rows are whatever the table happens to hold. This is the seam that lets
 * those be real tests against inputs the table does not contain.
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
