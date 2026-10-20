/**
 * apple-app-site-association — which iOS/Mac apps may use passkeys on this domain
 * (`webcredentials`) and open its links (`applinks`). Served at
 * /.well-known/apple-app-site-association.
 *
 * It was a static file in public/, so every partner domain claimed Astrid's apps
 * (AWTD-1281). A partner shipping its own apps sets BRAND_APPLE_APP_IDS to their
 * `<TEAM ID>.<bundle id>` values, comma-separated; each is listed for both.
 *
 * Unset, this is Astrid's file byte for byte (pinned by
 * tests/fixtures/brand/astrid-apple-app-site-association.json). That default is also
 * right for a partner running the Astrid-signed test binaries, such as the
 * whitelabel-partner profile.
 */

/** Paths a universal link opens in the app rather than the browser. */
const APPLINK_PATHS = ['/s/*', '/tasks/*', '/lists/*']

/**
 * Apple app identifiers, not branding: provisioning identities registered with Apple,
 * the same reasoning as lib/auth/apple-identity.ts.
 */
const ASTRID_ASSOCIATION = {
  webcredentials: {
    apps: [
      '34K3P7PD2W.Graceful-Tools-Inc.Astrid-App',
      '34K3P7PD2W.Graceful-Tools-Inc.Astrid-Mac',
      '34K3P7PD2W.Graceful-Tools-Inc.Whitelabel',
    ],
  },
  // The Mac app is listed for passkeys only, as it was in the static file.
  applinks: {
    apps: [],
    details: [
      { appID: '34K3P7PD2W.Graceful-Tools-Inc.Astrid-App', paths: APPLINK_PATHS },
      { appID: '34K3P7PD2W.Graceful-Tools-Inc.Whitelabel', paths: APPLINK_PATHS },
    ],
  },
}

/** The association document, serialised exactly as it is served. */
export function appleAppSiteAssociation(appIdsEnv: string | undefined = process.env.BRAND_APPLE_APP_IDS): string {
  const appIds = (appIdsEnv ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  const association = appIds.length === 0
    ? ASTRID_ASSOCIATION
    : {
        webcredentials: { apps: appIds },
        applinks: { apps: [], details: appIds.map((appID) => ({ appID, paths: APPLINK_PATHS })) },
      }

  return `${JSON.stringify(association, null, 2)}\n`
}
