import { ENV_VARS } from '../env'
import { brandIconSourceProblem } from './icon-source'

/**
 * Turn a `brands/*.brand.json` profile into the environment a deployment needs.
 *
 * Task 97208a72. Shared by scripts/deploy-brand-preview.ts and
 * tests/brands/brand-matrix.test.ts deliberately: if the tests applied a profile
 * differently from the way a deploy applies it, the suite would pass while real
 * deployments shipped something else. That is exactly what happened with the `copy`
 * block — the tests set only `env`, so brand reminder and list copy was verified as
 * absent while the deploy script was serialising it.
 */

export interface BrandProfile {
  name: string
  description: string
  env: Record<string, string>
  /** Reminder nags and default-list captions — a voice, supplied as a set. */
  copy?: Record<string, unknown>
  /**
   * A partner's own Apple identity, read by astrid-ios's `make-brand-variant.sh`
   * (AITD-515) and by NOTHING on the server. `bundleId`, `appGroup`,
   * `keychainGroup`, `developmentTeam`, `displayName` — every key optional, and
   * the block itself optional: leave it out and the native build is Astrid's own
   * Whitelabel variant.
   *
   * Declared here even though the web never reads it, because the profile is one
   * file shared by both repos and an undeclared key reads as a mistake. It must
   * stay OUT of `profileEnv` — see the note there (AWTD-1289).
   */
  ios?: Record<string, string>
  /**
   * Brand artwork (AWTD-1588). `icon` is the one square source icon, ideally 1024 px, as a
   * path in public/ (e.g. `/icons/acme-1024.png`); every favicon, manifest, touch and
   * notification icon is generated from it. The same field name as the astrid-core
   * brand schema (AWTD2-158), so one profile serves both. Becomes NEXT_PUBLIC_BRAND_ICON.
   */
  assets?: { icon?: string }
  expect?: Record<string, unknown>
}

export interface BrandEnvWrite {
  key: string
  value: string
  why: string
}

const PROFILE_ENV_PREFIXES = ['NEXT_PUBLIC_BRAND_', 'BRAND_', 'AUTH_SSO_']
const PROFILE_ENV_VARS = new Map(
  ENV_VARS
    .filter(({ name }) => PROFILE_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .map((envVar) => [envVar.name, envVar]),
)
const PROFILE_KEYS = new Set(['name', 'description', 'env', 'copy', 'ios', 'assets', 'expect'])
const ASSET_PROFILE_KEYS = new Set(['icon'])
const IOS_PROFILE_KEYS = new Set(['bundleId', 'appGroup', 'keychainGroup', 'developmentTeam', 'displayName'])
const PROFILE_DERIVED_ENV_KEYS = new Set(['NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

/**
 * Validate untrusted profile JSON without rewriting any accepted values.
 * The environment registry is the source of truth for supported brand keys and
 * their existing validators; unknown profile and environment keys fail closed.
 */
export function parseBrandProfile(value: unknown, source = 'Brand profile'): BrandProfile {
  if (!isRecord(value)) {
    throw new Error(`${source}: profile must be an object`)
  }

  const problems: string[] = []
  for (const key of Object.keys(value)) {
    if (!PROFILE_KEYS.has(key)) problems.push(`unknown profile key "${key}"`)
  }

  if (typeof value.name !== 'string' || value.name.trim() === '') {
    problems.push('name is required and must be a non-empty string')
  }
  if (typeof value.description !== 'string' || value.description.trim() === '') {
    problems.push('description is required and must be a non-empty string')
  }

  const env = value.env
  if (!isRecord(env)) {
    problems.push('env is required and must be an object')
  } else {
    for (const [key, envValue] of Object.entries(env)) {
      const envVar = PROFILE_ENV_VARS.get(key)
      if (!envVar) {
        problems.push(`env.${key} is not a supported brand environment key`)
        continue
      }
      if (typeof envValue !== 'string') {
        problems.push(`env.${key} must be a string`)
        continue
      }
      if (envVar.validate?.(envValue)) {
        problems.push(`env.${key} failed validation`)
      }
    }
  }

  for (const key of ['copy', 'expect'] as const) {
    if (value[key] !== undefined && !isRecord(value[key])) {
      problems.push(`${key} must be an object`)
    }
  }

  if (value.ios !== undefined) {
    if (!isStringRecord(value.ios)) {
      problems.push('ios must be an object with string values')
    } else {
      for (const key of Object.keys(value.ios)) {
        if (!IOS_PROFILE_KEYS.has(key)) problems.push(`ios.${key} is not a supported profile key`)
      }
    }
  }

  if (value.assets !== undefined) {
    if (!isStringRecord(value.assets)) {
      problems.push('assets must be an object with string values')
    } else {
      for (const key of Object.keys(value.assets)) {
        if (!ASSET_PROFILE_KEYS.has(key)) problems.push(`assets.${key} is not a supported profile key`)
      }
      const icon = value.assets.icon
      // The same rule NEXT_PUBLIC_BRAND_ICON is held to (lib/brand/icon-source.ts).
      const iconProblem = icon === undefined ? null : brandIconSourceProblem(icon)
      if (iconProblem) problems.push(`assets.icon: ${iconProblem}`)
      const envIcon = isRecord(env) ? env.NEXT_PUBLIC_BRAND_ICON : undefined
      if (icon !== undefined && envIcon !== undefined && envIcon !== icon) {
        problems.push('assets.icon and env.NEXT_PUBLIC_BRAND_ICON disagree; set only assets.icon')
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`${source}: invalid brand profile:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
  }

  const profile: BrandProfile = {
    name: value.name as string,
    description: value.description as string,
    env: env as Record<string, string>,
  }
  if (value.copy !== undefined) profile.copy = value.copy as Record<string, unknown>
  if (value.ios !== undefined) profile.ios = value.ios as Record<string, string>
  if (value.assets !== undefined) profile.assets = value.assets as { icon?: string }
  if (value.expect !== undefined) profile.expect = value.expect as Record<string, unknown>
  return profile
}

/** Environment variable carrying the serialised copy set. See lib/brand/copy.ts. */
export const BRAND_COPY_ENV = 'NEXT_PUBLIC_BRAND_COPY'

/**
 * GitHub's brand guidelines allow the descriptive "<Brand> for GitHub Projects", never a
 * product name that starts with GitHub (spec GITHUB_PROJECTS_WHITELABEL.md §11.1).
 * Returns the problem, or null when the name is fine.
 */
export function brandNameTrademarkProblem(name: string): string | null {
  if (!/^\s*git\s?hub/i.test(name)) return null
  return `"${name}" starts with GitHub — name the product "<Brand> for GitHub Projects" instead`
}

/**
 * The complete environment for a profile: its explicit `env`, plus `copy` serialised
 * into one variable so the profile can hold it as readable JSON.
 */
export function profileEnv(profile: BrandProfile): Record<string, string> {
  const validProfile = parseBrandProfile(profile)
  return {
    ...validProfile.env,
    ...(validProfile.assets?.icon ? { NEXT_PUBLIC_BRAND_ICON: validProfile.assets.icon } : {}),
    ...(validProfile.copy ? { [BRAND_COPY_ENV]: JSON.stringify(validProfile.copy) } : {}),
  }
}

/**
 * Show the key-level changes a Vercel profile push would make without exposing
 * profile values. The Vercel list API exposes key names only, so existing keys
 * are reported as updates rather than compared by value.
 */
export function formatBrandEnvDryRun(
  targetKeys: readonly string[],
  writes: readonly BrandEnvWrite[],
): string[] {
  const existing = new Set(targetKeys)
  const planned = new Set(writes.map(({ key }) => key))
  const lines = [
    ...writes.map(({ key }) => `${existing.has(key) ? 'update' : 'add'} ${key} (value redacted)`),
    ...targetKeys
      .filter((key) => (
        (PROFILE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) || PROFILE_DERIVED_ENV_KEYS.has(key)) &&
        !planned.has(key)
      ))
      .sort()
      .map((key) => `stale ${key} (retained; no deletion)`),
  ]
  return lines.length > 0 ? lines : ['no brand environment changes']
}

export function redactBrandProfileValues(text: string, values: readonly string[]): string {
  return values
    .filter((value) => value.length > 0)
    .reduce((redacted, value) => redacted.replaceAll(value, '[redacted]'), text)
}

export function extractBrandPreviewUrl(output: string): string | null {
  return output.match(/https:\/\/[a-z0-9-]+\.vercel\.app/)?.[0] ?? null
}

/**
 * Top-level profile keys that are deliberately NOT part of a deployment's
 * environment (AWTD-1289).
 *
 * `ios` is a partner's Apple identity — bundle id, App Group, keychain group,
 * Apple team. It belongs to the native build and a web deployment has no use for
 * it, so spreading the profile wholesale instead of `profile.env` would publish
 * one partner's signing identity into another's environment. The `copy` block
 * already showed how this goes wrong in the other direction: the tests set only
 * `env`, so brand copy was verified as ABSENT while the deploy script was
 * serialising it.
 *
 * Exported so tests/brands/profile-ios-block.test.ts can assert the exclusion by
 * name rather than by a hardcoded list that drifts from this one.
 */
export const NON_ENV_PROFILE_KEYS = ['ios'] as const
