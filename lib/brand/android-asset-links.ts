/**
 * assetlinks.json — which Android apps may verify this domain's https links
 * (`android:autoVerify`). Served at /.well-known/assetlinks.json (AWTD-1303; the
 * Android half is AATD-76).
 *
 * BRAND_ANDROID_APP_LINKS lists `<package>:<sha256 fingerprint>` pairs, comma-separated.
 * The fingerprint is the Play **app-signing** key's, not the upload key's, and is itself
 * colon-separated, so a pair splits on its first colon. A package may appear more than
 * once; its fingerprints are merged into one statement.
 *
 * Unset, there is no file: unlike apple-app-site-association there is no Astrid default,
 * because Astrid has no Play app-signing fingerprint yet. A domain must never claim an
 * app it cannot name the key of.
 */

const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/
const SHA256_FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/

interface AppLink {
  packageName: string
  fingerprint: string
}

function parsePair(pair: string): AppLink | string {
  const colon = pair.indexOf(':')
  if (colon < 0) return `"${pair}" has no fingerprint; expected <package>:<sha256 fingerprint>`
  const packageName = pair.slice(0, colon).trim()
  const fingerprint = pair.slice(colon + 1).trim().toUpperCase()
  if (!PACKAGE.test(packageName)) return `"${packageName}" is not an Android package name`
  if (!SHA256_FINGERPRINT.test(fingerprint)) {
    return `"${packageName}" fingerprint must be 32 colon-separated hex bytes (SHA-256 of the Play app-signing key)`
  }
  return { packageName, fingerprint }
}

function pairs(value: string): string[] {
  return value.split(',').map((p) => p.trim()).filter(Boolean)
}

/** The first problem with a BRAND_ANDROID_APP_LINKS value, or null. Used by lib/env.ts. */
export function androidAppLinksProblem(value: string): string | null {
  for (const pair of pairs(value)) {
    const parsed = parsePair(pair)
    if (typeof parsed === 'string') return parsed
  }
  return null
}

/** The assetlinks.json document as served, or null when this deployment names no app. */
export function androidAssetLinks(
  value: string | undefined = process.env.BRAND_ANDROID_APP_LINKS
): string | null {
  const byPackage = new Map<string, string[]>()
  for (const pair of pairs(value ?? '')) {
    // A malformed pair is refused by env validation before deploy; skipping it here
    // means a bad value can only ever claim less, never the wrong app.
    const parsed = parsePair(pair)
    if (typeof parsed === 'string') continue
    const fingerprints = byPackage.get(parsed.packageName) ?? []
    if (!fingerprints.includes(parsed.fingerprint)) fingerprints.push(parsed.fingerprint)
    byPackage.set(parsed.packageName, fingerprints)
  }
  if (byPackage.size === 0) return null

  const statements = [...byPackage].map(([packageName, fingerprints]) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
  }))
  return `${JSON.stringify(statements, null, 2)}\n`
}
