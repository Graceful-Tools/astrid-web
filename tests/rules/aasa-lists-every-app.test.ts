/**
 * Every app that signs in with passkeys must be named in apple-app-site-association, or iOS
 * refuses the passkey before the server is ever asked. The Whitelabel app (bundle
 * Graceful-Tools-Inc.Whitelabel, astrid-ios "Whitelabel" configuration) signs in on its
 * partner's domain, and that domain serves this same file — so it has to be listed here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const aasa = JSON.parse(readFileSync(join(process.cwd(), 'public/.well-known/apple-app-site-association'), 'utf8'))

describe('apple-app-site-association names every app that uses it', () => {
  it.each([
    '34K3P7PD2W.Graceful-Tools-Inc.Astrid-App',
    '34K3P7PD2W.Graceful-Tools-Inc.Astrid-Mac',
    '34K3P7PD2W.Graceful-Tools-Inc.Whitelabel',
  ])('lists %s for passkeys (webcredentials)', (appId) => {
    expect(aasa.webcredentials.apps).toContain(appId)
  })

  it('opens the Whitelabel app for its links (applinks)', () => {
    expect(aasa.applinks.details.map((d: { appID: string }) => d.appID)).toContain('34K3P7PD2W.Graceful-Tools-Inc.Whitelabel')
  })
})
