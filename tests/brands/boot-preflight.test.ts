// @vitest-environment node
/**
 * The brand deploy scripts' preflight must refuse exactly what the server's boot refuses.
 *
 * AWTD-1298: brands/github-projects.brand.json listed `github,sso`, and deploying it as
 * docs/WHITELABELING.md §8 said produced a deployment that answered 500
 * MIDDLEWARE_INVOCATION_FAILED on every route, because instrumentation.ts refused to boot
 * without AUTH_SSO_*. Nothing before the deploy said so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { profileEnv, type BrandProfile } from '@/lib/brand/profile'
import { bootPreflightProblems } from '@/lib/brand/boot-preflight'
import { deploymentEnv, storedKeysFor } from '@/scripts/lib/brand-boot-preflight'

vi.mock('@vercel/otel', () => ({ registerOTel: vi.fn() }))

const BRANDS_DIR = join(process.cwd(), 'brands')
const PROFILES = readdirSync(BRANDS_DIR)
  .filter((file) => file.endsWith('.brand.json'))
  .map((file) => JSON.parse(readFileSync(join(BRANDS_DIR, file), 'utf8')) as BrandProfile)

const GITHUB_APP = {
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: 'key',
  GITHUB_WEBHOOK_SECRET: 'secret',
  GITHUB_CLIENT_ID: 'Iv1.x',
  GITHUB_CLIENT_SECRET: 'secret',
  NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG: 'lanes',
}
const SSO = {
  AUTH_SSO_ISSUER: 'https://idp.example',
  AUTH_SSO_CLIENT_ID: 'client',
  AUTH_SSO_CLIENT_SECRET: 'secret',
  AUTH_SSO_DOMAINS: 'example.com',
}

describe('bootPreflightProblems (AWTD-1298)', () => {
  it('rejects a github,sso profile with no AUTH_SSO_* and names each missing variable', () => {
    const problems = bootPreflightProblems({
      ...GITHUB_APP,
      NEXT_PUBLIC_BRAND_AUTH_PROVIDERS: 'github,sso',
      NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS: 'true',
    })

    expect(problems).toHaveLength(1)
    for (const name of Object.keys(SSO)) expect(problems[0]).toContain(name)
  })

  it('passes the same profile once AUTH_SSO_* is set', () => {
    expect(
      bootPreflightProblems({
        ...GITHUB_APP,
        ...SSO,
        NEXT_PUBLIC_BRAND_AUTH_PROVIDERS: 'github,sso',
        NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS: 'true',
      }),
    ).toEqual([])
  })

  it('names the GitHub App credentials a Projects brand is missing', () => {
    const problems = bootPreflightProblems({
      NEXT_PUBLIC_BRAND_AUTH_PROVIDERS: 'github',
      NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS: 'true',
      NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG: 'lanes',
    }).join('\n')

    for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) {
      expect(problems).toContain(name)
    }
  })

  it('passes hosted Astrid, which sets nothing', () => {
    expect(bootPreflightProblems({})).toEqual([])
  })
})

describe('deploymentEnv (AWTD-1298)', () => {
  it('counts a variable already stored on the project as present without knowing its value', () => {
    const env = deploymentEnv(['AUTH_SSO_ISSUER'], { NEXT_PUBLIC_BRAND_AUTH_PROVIDERS: 'sso' })
    expect(env.AUTH_SSO_ISSUER).toBeTruthy()
    expect(env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS).toBe('sso')
  })

  it('reads stored names per Vercel environment', () => {
    const rows = [
      { key: 'AUTH_SSO_ISSUER', target: ['production'] },
      { key: 'GITHUB_APP_ID', target: ['production', 'preview'] },
      { key: 'GITHUB_WEBHOOK_SECRET', target: 'preview' },
    ]
    expect(storedKeysFor(rows, 'preview')).toEqual(['GITHUB_APP_ID', 'GITHUB_WEBHOOK_SECRET'])
    expect(storedKeysFor(rows, 'production')).toEqual(['AUTH_SSO_ISSUER', 'GITHUB_APP_ID'])
  })

  it('lets a value being sent override the stored one', () => {
    expect(deploymentEnv(['NEXT_PUBLIC_BRAND_AUTH_PROVIDERS'], { NEXT_PUBLIC_BRAND_AUTH_PROVIDERS: 'github' }))
      .toMatchObject({ NEXT_PUBLIC_BRAND_AUTH_PROVIDERS: 'github' })
  })
})

describe.each(PROFILES)('brand profile $name: preflight agrees with the real boot', (profile) => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.resetModules()
  })

  // The documented credentials, none, and everything: the preflight must say "refuse"
  // exactly when instrumentation.ts's register() would throw.
  const CASES: Array<[string, Record<string, string>]> = [
    ['no credentials', {}],
    ['the GitHub App only', GITHUB_APP],
    ['GitHub App and SSO', { ...GITHUB_APP, ...SSO }],
  ]

  it.each(CASES)('with %s', async (_label, credentials) => {
    const env = { ...profileEnv(profile), ...credentials }

    process.env = { NODE_ENV: 'test', ...env }
    vi.resetModules()
    const { register } = await import('@/instrumentation')
    const bootFails = await register().then(() => false, () => true)

    expect(bootPreflightProblems(env).length > 0).toBe(bootFails)
  })
})

describe('the documented GitHub Projects deploy boots (AWTD-1298)', () => {
  beforeEach(() => vi.resetModules())

  it('github-projects needs only the six GitHub App credentials (WHITELABELING §8 step 4)', () => {
    const profile = PROFILES.find((p) => p.name === 'Lanes for GitHub Projects')!
    expect(bootPreflightProblems({ ...profileEnv(profile), ...GITHUB_APP })).toEqual([])
  })
})
