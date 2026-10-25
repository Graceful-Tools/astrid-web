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
  expect?: Record<string, unknown>
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
  return {
    ...profile.env,
    ...(profile.copy ? { [BRAND_COPY_ENV]: JSON.stringify(profile.copy) } : {}),
  }
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
