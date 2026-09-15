/**
 * AWTD-942 — picking the newest Mac release, and refusing to advertise one
 * that cannot be downloaded.
 *
 * The Mac app is not on the Mac App Store. It is a notarized DMG attached to a
 * `mac-v*` release on Graceful-Tools/astrid-ios, so GitHub Releases is the
 * authoritative source for "what is the latest Mac version" — there is no
 * store listing to ask, and the iTunes lookup API answers for the iOS app
 * (`kind: software`) rather than a Mac one (`kind: mac-software`).
 *
 * Selection is separated from fetching so these rules are testable without a
 * network call. Two of them matter more than they look: a DRAFT release is not
 * published, and a release whose asset upload failed has a tag but no DMG.
 * Advertising either would tell users an update exists that they cannot get —
 * which is exactly the failure that prompted this (a hardcoded 1.1.1 against a
 * real latest of 1.0.3, linking to a page with no Mac download on it).
 */
import { describe, it, expect } from 'vitest'
import { selectLatestMacRelease, versionFromMacTag } from '@/lib/mac-release'

const dmg = (name: string) => ({
  name,
  size: 44_040_192,
  browser_download_url: `https://github.com/Graceful-Tools/astrid-ios/releases/download/x/${name}`,
})

describe('versionFromMacTag (AWTD-942)', () => {
  it.each([
    ['mac-v1.0.3', '1.0.3'],
    ['mac-1.0.3', '1.0.3'],
    ['mac-v1.0', '1.0'],
  ])('%s -> %s', (tag, expected) => expect(versionFromMacTag(tag)).toBe(expected))
})

describe('selectLatestMacRelease (AWTD-942)', () => {
  it('takes the first published mac release that has a DMG', () => {
    const release = selectLatestMacRelease([
      { tag_name: 'mac-v1.0.3', published_at: '2026-07-29T13:31:39Z', assets: [dmg('Astrid-Mac-1.0.3.dmg')] },
      { tag_name: 'mac-v1.0.2', published_at: '2026-07-29T04:36:59Z', assets: [dmg('Astrid-Mac-1.0.2.dmg')] },
    ])
    expect(release?.version).toBe('1.0.3')
    expect(release?.url).toMatch(/Astrid-Mac-1\.0\.3\.dmg$/)
  })

  it('skips a draft, which is not released to anyone', () => {
    const release = selectLatestMacRelease([
      { tag_name: 'mac-v1.1.0', draft: true, assets: [dmg('Astrid-Mac-1.1.0.dmg')] },
      { tag_name: 'mac-v1.0.3', published_at: '2026-07-29T13:31:39Z', assets: [dmg('Astrid-Mac-1.0.3.dmg')] },
    ])
    expect(release?.version).toBe('1.0.3')
  })

  it('skips a release whose DMG never uploaded, rather than offering a tag', () => {
    // A published release with no asset is the shape a failed upload leaves.
    const release = selectLatestMacRelease([
      { tag_name: 'mac-v1.1.0', published_at: '2026-08-01T00:00:00Z', assets: [] },
      { tag_name: 'mac-v1.0.3', published_at: '2026-07-29T13:31:39Z', assets: [dmg('Astrid-Mac-1.0.3.dmg')] },
    ])
    expect(release?.version).toBe('1.0.3')
  })

  it('ignores iOS releases sharing the repository', () => {
    // astrid-ios carries both; only mac-* tags describe the Mac app.
    const release = selectLatestMacRelease([
      { tag_name: 'v1.9.2', published_at: '2026-09-01T00:00:00Z', assets: [dmg('ios.dmg')] },
      { tag_name: 'mac-v1.0.3', published_at: '2026-07-29T13:31:39Z', assets: [dmg('Astrid-Mac-1.0.3.dmg')] },
    ])
    expect(release?.version).toBe('1.0.3')
  })

  it('answers null when nothing is downloadable, so no card is shown', () => {
    expect(selectLatestMacRelease([])).toBeNull()
    expect(selectLatestMacRelease([{ tag_name: 'mac-v1.0.3', assets: [] }])).toBeNull()
  })
})
