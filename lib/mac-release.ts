/**
 * The latest released Mac build, resolved from GitHub Releases.
 *
 * WHY THIS IS THE SOURCE (AWTD-942). The Mac app is NOT on the Mac App Store.
 * It ships as a notarized DMG attached to a `mac-v*` release on
 * Graceful-Tools/astrid-ios. So there is no store listing to ask, and the
 * iTunes lookup API cannot answer: id 6755752694 is the iOS app
 * (`kind: software`, versioned independently), and a native Mac App Store app
 * would report `kind: mac-software` — which no Graceful Tools listing does.
 *
 * Getting this wrong is not a cosmetic error. AWTD-924 hardcoded a Mac
 * `latestVersion` of 1.1.1 with the iOS App Store as its `updateUrl`, while the
 * newest Mac release was 1.0.3. Every Mac user therefore saw an update card
 * that sent them to an iOS listing with no Mac download on it — the exact
 * "nags on every launch" failure lib/app-version.ts warns about.
 *
 * Deriving it removes the class of bug rather than the instance: publishing a
 * release is already the only step needed to ship a Mac update, because
 * app/[locale]/download reads the same source. This module is that logic,
 * shared, so the download page and the update endpoint cannot disagree about
 * what the newest Mac build is.
 */

/** The repository whose releases carry the Mac DMG. */
export const MAC_RELEASE_REPO = 'Graceful-Tools/astrid-ios'

/**
 * Where the download page points when the DMG cannot be resolved: the releases
 * index, which lists every build. A link to a real page that needs one more
 * click beats a dead direct link to an asset we failed to find.
 */
export const MAC_RELEASES_FALLBACK_URL = `https://github.com/${MAC_RELEASE_REPO}/releases/latest`

export interface MacRelease {
  /** Version without the tag prefix, e.g. `1.0.3` from `mac-v1.0.3`. */
  version: string
  /** Direct link to the .dmg asset. */
  url: string
  /** Human-readable asset size, e.g. `42 MB`. */
  size: string
  /** Localized publish date for display. */
  published: string
}

interface GitHubAsset {
  name: string
  size: number
  browser_download_url: string
}

interface GitHubRelease {
  draft?: boolean
  tag_name?: string
  published_at?: string
  assets?: GitHubAsset[]
}

/** `mac-v1.0.3` and `mac-1.0.3` both yield `1.0.3`. */
export function versionFromMacTag(tag: string): string {
  return String(tag).replace(/^mac-v?/, '')
}

/**
 * Pick the newest published Mac release that actually has a DMG attached.
 *
 * Separated from fetching so the selection rules are testable without a
 * network call — a draft, or a release whose upload failed and left no asset,
 * must both be skipped rather than advertised as downloadable.
 */
export function selectLatestMacRelease(releases: GitHubRelease[]): MacRelease | null {
  for (const release of releases) {
    if (release.draft || !String(release.tag_name ?? '').startsWith('mac-')) continue
    const asset = (release.assets ?? []).find((candidate) => candidate.name.endsWith('.dmg'))
    if (!asset) continue

    return {
      version: versionFromMacTag(release.tag_name ?? ''),
      url: asset.browser_download_url,
      size: `${(asset.size / 1_048_576).toFixed(0)} MB`,
      published: release.published_at
        ? new Date(release.published_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : '',
    }
  }
  return null
}

/**
 * The newest Mac release, or null when GitHub cannot be reached.
 *
 * Null is a working answer, not an error: both callers treat "unknown" as
 * "offer nothing" — the download page falls back to the releases index, and
 * the version endpoint omits the row, which the clients read as "no update
 * known". Never invent a version here; a wrong one nags every user.
 */
export async function fetchLatestMacRelease(): Promise<MacRelease | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${MAC_RELEASE_REPO}/releases`, {
      headers: { Accept: 'application/vnd.github+json' },
      // Releases are rare; do not hammer an unauthenticated API with a 60/hr limit.
      next: { revalidate: 900 },
    })
    if (!response.ok) return null
    return selectLatestMacRelease((await response.json()) as GitHubRelease[])
  } catch {
    return null
  }
}
