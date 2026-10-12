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
