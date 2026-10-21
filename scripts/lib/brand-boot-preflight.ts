/**
 * What a brand deployment will boot with, as seen from the deploy scripts (AWTD-1298).
 *
 * scripts/deploy-brand-preview.ts and scripts/push-brand-env.ts send the profile's
 * variables, but the secrets a boot check needs (GitHub App, SSO, OAuth clients) are
 * already stored on the Vercel project. The Vercel API lists those by name without their
 * values, which is all lib/brand/boot-preflight.ts needs: every check there is "is it set".
 */

/** Stands in for a stored variable whose value the preflight neither has nor needs. */
const STORED = '(stored on the Vercel project)'

export function deploymentEnv(
  storedKeys: readonly string[],
  sent: Record<string, string>,
): Record<string, string> {
  return { ...Object.fromEntries(storedKeys.map((key) => [key, STORED])), ...sent }
}

export interface VercelEnvRow {
  key: string
  target?: string[] | string
}

/**
 * The names stored for one Vercel environment (production, preview). A preview row scoped
 * to one git branch counts too: the preflight would rather miss a refusal than invent one.
 */
export function storedKeysFor(rows: readonly VercelEnvRow[], environment: 'production' | 'preview'): string[] {
  return rows
    .filter((row) => (Array.isArray(row.target) ? row.target : [row.target]).includes(environment))
    .map((row) => row.key)
}

/** Names only: the list endpoint returns values encrypted, and nothing here reads them. */
export async function fetchStoredEnvRows(projectId: string, teamId: string, token: string): Promise<VercelEnvRow[]> {
  const response = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env?teamId=${teamId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`could not list the project's environment variables: HTTP ${response.status}`)
  return ((await response.json()) as { envs: VercelEnvRow[] }).envs
}

/** Prints why the deployment would not boot and exits, or returns when it would. */
export function refuseIfBootWouldFail(problems: readonly string[], where: string): void {
  if (problems.length === 0) return
  console.error(`\n❌ ${where} would not boot — the server refuses to start with:`)
  for (const problem of problems) console.error(`   - ${problem}`)
  console.error('\n   On Vercel that is a 500 MIDDLEWARE_INVOCATION_FAILED on every route. Set the variables')
  console.error('   on the Vercel project or change the profile, then run this again (docs/WHITELABELING.md §8).')
  process.exit(1)
}
