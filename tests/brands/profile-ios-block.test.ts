/**
 * AWTD-1289: a profile may carry a partner's Apple identity, and the web must
 * not ship it.
 *
 * astrid-ios AITD-515 taught `scripts/make-brand-variant.sh` to read an optional
 * top-level `ios` block in `brands/*.brand.json` — `bundleId`, `appGroup`,
 * `keychainGroup`, `developmentTeam`, `displayName`, every key optional. One
 * profile, both repos: a partner describes their brand once.
 *
 * Nothing on the server reads that block, which is exactly why it needs a test.
 * The interesting question is not whether an unknown key is ACCEPTED — nothing
 * in the brand tooling rejects extra keys, so of course it is. It is whether the
 * key LEAKS. All three tools that turn a profile into a deployment
 * (deploy-brand-preview.ts, push-brand-env.ts, brand-audit.ts) go through
 * `profileEnv`, and `profileEnv` spreads `profile.env` rather than the profile —
 * so a partner's signing identity cannot become an environment variable on a web
 * deployment.
 *
 * That distinction has gone wrong here before, in the other direction. From
 * lib/brand/profile.ts's own header: the `copy` block was verified as absent by
 * tests that set only `env`, while the deploy script was serialising it the whole
 * time. A test that only checked "does it load" would miss this one just as
 * completely.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  profileEnv,
  BRAND_COPY_ENV,
  NON_ENV_PROFILE_KEYS,
  type BrandProfile,
} from '@/lib/brand/profile'

const BRANDS = join(process.cwd(), 'brands')

/** A partner's own Apple identity, exactly as astrid-ios docs/BRAND_VARIANT.md documents it. */
const ACME_IOS = {
  bundleId: 'com.acme.tasks',
  appGroup: 'group.com.acme.tasks',
  keychainGroup: 'com.acme.tasks',
  developmentTeam: 'ABCDE12345',
  displayName: 'Acme Tasks',
}

function profileWithIos(): BrandProfile {
  return {
    name: 'Acme',
    description: 'a partner shipping their own app',
    env: { NEXT_PUBLIC_BRAND_NAME: 'Acme' },
    ios: ACME_IOS,
  }
}

describe('the brand profile tolerates an `ios` block (AWTD-1289)', () => {
  it('the block is a declared part of the profile, not an unknown key', () => {
    // A type assertion would be erased at runtime and prove nothing, so this
    // reads the declaration the way a caller does.
    const profile = profileWithIos()

    expect(profile.ios?.bundleId).toBe('com.acme.tasks')
    expect(profile.ios?.developmentTeam).toBe('ABCDE12345')
  })

  it('AWTD-1289: a partner\'s Apple identity never reaches the deployment environment', () => {
    // The whole point. `profileEnv` is what every deploy path calls, so an
    // exclusion proved here is an exclusion everywhere.
    const env = profileEnv(profileWithIos())

    expect(env).toEqual({ NEXT_PUBLIC_BRAND_NAME: 'Acme' })
    for (const [key, value] of Object.entries(ACME_IOS)) {
      expect(Object.keys(env), `${key} leaked as a variable name`).not.toContain(key)
      expect(
        Object.values(env),
        `${value} leaked as a variable value`,
      ).not.toContain(value)
    }
  })

  it('AWTD-1289: and it does not ride along inside the serialised copy set either', () => {
    // `copy` is the one block that IS serialised into a variable. If `ios` were
    // ever folded in with it, the assertion above would still pass while the
    // identity shipped inside NEXT_PUBLIC_BRAND_COPY.
    const env = profileEnv({ ...profileWithIos(), copy: { reminders: { gentle: ['hi'] } } })

    expect(env[BRAND_COPY_ENV]).not.toContain('com.acme.tasks')
    expect(env[BRAND_COPY_ENV]).not.toContain('ABCDE12345')
  })

  it('every key the profile deliberately keeps out of the environment is tested here', () => {
    // If someone adds a second non-env block, this fails until it is covered,
    // rather than the new block silently going untested.
    expect(NON_ENV_PROFILE_KEYS).toEqual(['ios'])
  })

  it('the committed profiles still parse, with or without the block', () => {
    // No profile carries `ios` yet. This is the guard for when one does: the
    // block must not break the files every brand test and deploy reads.
    const files = readdirSync(BRANDS).filter(f => f.endsWith('.brand.json'))
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const profile = JSON.parse(readFileSync(join(BRANDS, file), 'utf8')) as BrandProfile
      expect(profile.name, file).toBeTruthy()
      expect(profileEnv(profile), file).not.toHaveProperty('ios')
      if (profile.ios) {
        expect(typeof profile.ios, file).toBe('object')
      }
    }
  })
})
