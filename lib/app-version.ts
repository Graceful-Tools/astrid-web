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
 * ASK WHOEVER PUBLISHES THE PLATFORM. For iOS that is the App Store, which we
 * cannot query for a pending release, so its row is a HAND-MAINTAINED TABLE —
 * it changes a few times a year, it belongs in a diff someone can review, and a
 * release can update it. What must never be derived is a build number we
 * control (`CURRENT_PROJECT_VERSION`, an Xcode Cloud run), because that runs
 * ahead of the store and nags every user on every launch.
 *
 * Mac is the other case: we ARE its publisher. It ships as a notarized DMG on
 * GitHub Releases, so that feed is the store, and its row is resolved per
 * request instead of typed in — see resolveAppVersionFor. Hardcoding it once
 * shipped a version that did not exist next to a link that could not install
 * it (AWTD-942).
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

import { fetchLatestMacRelease } from '@/lib/mac-release'
import { brandOrigin } from '@/lib/brand/config'

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
 * The iOS App Store listing. iOS ONLY — see the mac row below.
 *
 * Verified against the iTunes lookup API (AWTD-924): trackName `Astrid Tasks`,
 * sellerName `Graceful Tools LLC`, bundleId `Graceful-Tools-Inc.Astrid-App`.
 *
 * IT DOES NOT SERVE MAC, despite `supportedDevices` listing
 * `MacDesktop-MacDesktop`. That entry means the iOS build can run on Apple
 * silicon, not that the Mac app is published here. The lookup API reports
 * `kind: software` for this id; a real Mac App Store app reports
 * `kind: mac-software`, and Graceful Tools has no such listing. AWTD-924
 * read that field as "one listing serves both" and shipped this URL for Mac,
 * which sent Mac users to an iOS page (AWTD-942).
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
  /**
   * EMPTY ON PURPOSE — Mac is resolved at request time, not hardcoded.
   *
   * The Mac app is not on the Mac App Store; it ships as a notarized DMG on
   * GitHub Releases. See resolveAppVersionFor below and lib/mac-release.ts.
   * A hardcoded value here was live for one deploy and was wrong in the
   * worst direction (AWTD-942): it claimed 1.1.1 against a real latest of
   * 1.0.3 and pointed at the iOS listing, so every Mac user got an update
   * card leading somewhere with no Mac download on it.
   */
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

/**
 * The answer actually served for a platform, resolving anything that is not
 * a fixed store listing.
 *
 * iOS comes from the table above — the App Store is the real source, and a
 * store version genuinely is a human-maintained fact.
 *
 * Mac is resolved from GitHub Releases, because that IS the Mac release
 * channel: the app is a notarized DMG, not a Mac App Store listing. Deriving
 * it means publishing a release ships the update, with no second step anyone
 * can forget — which is what went wrong when this was hardcoded (AWTD-942).
 *
 * A failed lookup yields `{}`, never a guess. The clients read a missing
 * `latestVersion` as "no update known" and show nothing, so an unreachable
 * GitHub degrades to silence rather than to a wrong number.
 */
export async function resolveAppVersionFor(platform: AppPlatform): Promise<AppVersionInfo> {
  if (platform !== 'mac') return appVersionFor(platform)

  const release = await fetchLatestMacRelease()
  if (!release) return {}

  return shapeAppVersionInfo({
    latestVersion: release.version,
    // Our own download page, not the DMG: it states the macOS requirement and
    // the notarization, and it resolves the newest build from the same source,
    // so a link copied out of a client cannot go stale.
    updateUrl: `${brandOrigin()}/download`,
  })
}
