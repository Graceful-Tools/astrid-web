/**
 * AWTD-1701: keep astrid-core's copy of the contract fixtures in step with web's.
 *
 * Web generates `contracts/fixtures/*.json` (scripts/export-contract-fixtures.ts) and core
 * compiles a copy in, checked by `cargo xtask check-contracts ../astrid-web`. A web change
 * that touches a fixture turns core main red until someone copies it over by hand. This is
 * the comparison the sync script and its workflow use to see that coming.
 *
 * Core also owns fixtures web does not generate, so only the names web has are compared.
 */

export type FixtureSet = Record<string, string>

export interface FixtureDiff {
  /** In both, with different content. */
  stale: string[]
  /** Web has it, core does not. */
  missing: string[]
}

export function diffFixtureSets(web: FixtureSet, core: FixtureSet): FixtureDiff {
  const stale: string[] = []
  const missing: string[] = []
  for (const name of Object.keys(web).sort()) {
    if (!(name in core)) missing.push(name)
    else if (core[name] !== web[name]) stale.push(name)
  }
  return { stale, missing }
}

export const isInSync = (diff: FixtureDiff) => diff.stale.length === 0 && diff.missing.length === 0

export function refreshPullRequestBody(diff: FixtureDiff, webSha: string): string {
  const lines = [
    `Refreshes the copied contract fixtures from astrid-web \`${webSha}\`, so \`cargo xtask check-contracts\` stays green.`,
    '',
    'Opened by astrid-web `core-fixture-sync` (AWTD-1701). Do not edit by hand: web generates these files.',
    '',
  ]
  for (const name of diff.stale) lines.push(`- changed: \`${name}\``)
  for (const name of diff.missing) lines.push(`- added: \`${name}\``)
  return lines.join('\n')
}
