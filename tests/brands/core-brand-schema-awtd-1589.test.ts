/**
 * AWTD-1589 step 2: web's brand profiles hold to astrid-core's brand schema.
 *
 * `brand/schema.json` in astrid-core (AWTD2-158) is the one description of a brand, and
 * `cargo xtask gen-brand` writes every client's resources from a profile that matches it. Web
 * keeps its own parser (lib/brand/profile.ts, keyed on the env registry in lib/env.ts), so this
 * holds the two together against the schema vendored at packages/astrid-rules/REVISION
 * (scripts/build-astrid-rules.sh copies it with the wasm):
 *
 *   - every env alias core declares is a key web reads, so the env file gen-brand writes for
 *     web is something web accepts;
 *   - every committed profile reads cleanly under core's rules — required fields, field types,
 *     a section winning over its alias, an empty optional being absent, and core's own verdict
 *     on the accent;
 *   - the platform blocks: core's schema names them differently from what each client reads
 *     today, which is pinned below so the gap is visible rather than silent.
 *
 * The section/alias reader is a few lines of core's `Schema::read_with`
 * (crates/xtask/src/brand.rs) rather than a call to it: CI has no Rust toolchain.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ENV_VARS } from '@/lib/env'
import { parseBrandProfile } from '@/lib/brand/profile'
import { ASTRID_ACCENT_COLOR } from '@/lib/brand/config'
import { coreBrandColors } from '@/scripts/lib/brand-colors.mjs'

interface SchemaField {
  type?: string
  required?: boolean
  env?: string
  default?: string
}
type Group = Record<string, Record<string, SchemaField>>
interface Schema {
  version: number
  sections: Group
  platforms: Group
}
type Profile = Record<string, unknown> & { env?: Record<string, string> }

const ROOT = process.cwd()
const SCHEMA: Schema = JSON.parse(readFileSync(join(ROOT, 'packages/astrid-rules/brand/schema.json'), 'utf8'))
const PROFILES: Array<readonly [string, Profile]> = readdirSync(join(ROOT, 'brands'))
  .filter((file) => file.endsWith('.brand.json'))
  .sort()
  .map((file) => [file, JSON.parse(readFileSync(join(ROOT, 'brands', file), 'utf8')) as Profile] as const)

function* fields(): Generator<[string, string, SchemaField]> {
  for (const group of [SCHEMA.sections, SCHEMA.platforms]) {
    for (const [section, entries] of Object.entries(group)) {
      for (const [name, field] of Object.entries(entries)) yield [section, name, field]
    }
  }
}

const HEX6 = /^#[0-9a-f]{6}$/i

/** core's `Kind::problem`. */
function typeProblem(type: string, value: string): string | null {
  switch (type) {
    case 'color':
      return HEX6.test(value) ? null : `${JSON.stringify(value)} is not a #rrggbb colour`
    case 'email':
      return value.includes('@') && value.includes('.') ? null : `${JSON.stringify(value)} is not an email address`
    case 'domain':
      return value.includes('.') && !value.includes('/') && !value.includes('@') ? null : `${JSON.stringify(value)} is not a bare domain`
    case 'scheme':
      return /^[a-z0-9]+$/.test(value) ? null : `${JSON.stringify(value)} is not a url scheme`
    case 'bool':
      return value === 'true' || value === 'false' ? null : `${JSON.stringify(value)} is not true or false`
    default:
      return null
  }
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return value.map(scalar).join(',')
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * core's `Schema::read_with`, with gen-brand's one overlay default (Astrid's accent, from
 * design/tokens.json's brand block — web's ASTRID_ACCENT_COLOR is that value).
 */
function readUnderCoreSchema(profile: Profile): { values: Map<string, string>; problems: string[] } {
  const env = profile.env ?? {}
  const defaults: Record<string, string> = { 'colors.accent': ASTRID_ACCENT_COLOR }
  const values = new Map<string, string>()
  const problems: string[] = []
  for (const [section, name, field] of fields()) {
    const key = `${section}.${name}`
    const block = profile[section]
    const fromSection =
      block && typeof block === 'object' && name in block ? scalar((block as Record<string, unknown>)[name]) : undefined
    const fromEnv = field.env && field.env in env ? scalar(env[field.env]) : undefined
    const value = fromSection ?? fromEnv ?? defaults[key] ?? field.default
    if (value === undefined || value === '') {
      if (field.required) problems.push(`${key} is required`)
      continue
    }
    const problem = typeProblem(field.type ?? 'string', value)
    if (problem) problems.push(`${key}: ${problem}`)
    else values.set(key, value)
  }
  if (!profile.name) problems.push('name is required')
  const accent = values.get('colors.accent')
  if (accent) {
    try {
      coreBrandColors(accent)
    } catch (error) {
      problems.push(`colors.accent: ${(error as Error).message}`)
    }
  }
  return { values, problems }
}

function acme(): Profile {
  return PROFILES.find(([file]) => file === 'acme.brand.json')![1]
}

describe("web's brand profiles against astrid-core's schema (AWTD-1589)", () => {
  it('vendors the schema at the pinned core revision', () => {
    expect(SCHEMA.version).toBeGreaterThanOrEqual(1)
    expect(Object.keys(SCHEMA.sections)).toEqual(expect.arrayContaining(['identity', 'colors', 'assets', 'capabilities']))
  })

  it('reads every env alias core declares, so gen-brand writes nothing web would reject', () => {
    const webKeys = new Set(ENV_VARS.map(({ name }) => name))
    const aliases = [...fields()].map(([, , field]) => field.env).filter((alias): alias is string => Boolean(alias))
    expect(aliases.length).toBeGreaterThan(20)
    expect(aliases.filter((alias) => !webKeys.has(alias))).toEqual([])
  })

  it('every env key a committed profile sets is one core reads too', () => {
    const aliases = new Set([...fields()].map(([, , field]) => field.env).filter(Boolean))
    for (const [file, profile] of PROFILES) {
      expect(Object.keys(profile.env ?? {}).filter((key) => !aliases.has(key)), file).toEqual([])
    }
  })

  it.each(PROFILES)("%s reads cleanly under core's rules, and under web's", (file, profile) => {
    expect(() => parseBrandProfile(profile, file)).not.toThrow()
    expect(readUnderCoreSchema(profile).problems).toEqual([])
  })

  it('reports what core would: a bad field by name, and an accent no label can be read on', () => {
    const broken = {
      ...acme(),
      env: { ...acme().env, NEXT_PUBLIC_BRAND_ACCENT_COLOR: '#a855f7', NEXT_PUBLIC_BRAND_APP_URL_SCHEME: 'Acme Tasks' },
    }
    expect(readUnderCoreSchema(broken).problems).toEqual([
      expect.stringMatching(/^identity\.url-scheme: /),
      expect.stringMatching(/^colors\.accent: .*3\.96:1/),
    ])
  })

  it('pins the platform-block gap: core names the fields differently from what each client reads', () => {
    // acme's blocks use the keys the clients read today (iOS BrandProfile.swift, astrid-windows
    // brand-profile.ps1, astrid-android brand.properties). core's schema names the same values
    // in kebab case with different words (`ios.bundle-id` for `bundleId`, `android.package` for
    // `applicationId`, `windows.package-identity` for `identityName`), so gen-brand reads none
    // of them. Which side renames is a cross-client call, filed on the core board (AWTD2-195) as
    // "[core][white-label] The brand schema's platform blocks use different field names from
    // what each client reads". It has landed: core `11ea272` reads each of these through an
    // `alias` key, and `cargo xtask gen-brand` on core's main writes acme's identities into every
    // platform's output (checked for AWTD-1648). Web's vendored schema predates it, so this list
    // still describes the pinned revision; when core is re-pinned it shrinks to the keys core
    // deliberately does not alias (android's own copies of shared values, `code.urlProtocol`).
    const profile = acme()
    const unknownToCore = Object.fromEntries(
      Object.keys(SCHEMA.platforms)
        .filter((platform) => profile[platform])
        .map((platform) => [
          platform,
          Object.keys(profile[platform] as object).filter((key) => !(key in SCHEMA.platforms[platform])).sort(),
        ]),
    )
    expect(unknownToCore).toEqual({
      ios: ['appGroup', 'bundleId', 'developmentTeam', 'displayName', 'keychainGroup'],
      android: [
        'accentColor', 'agentEmailDomain', 'appName', 'applicationId', 'baseUrl', 'handoffClientId',
        'inboundTaskEmail', 'linkAutoVerify', 'supportEmail', 'urlScheme', 'wordmark',
      ],
      windows: ['identityName', 'identityPublisher', 'publisherDisplayName'],
      vscode: ['displayName'],
      code: ['applicationName', 'bundleId', 'nameLong', 'nameShort', 'urlProtocol'],
    })
  })
})
