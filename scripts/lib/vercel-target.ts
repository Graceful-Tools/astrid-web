/**
 * Which Vercel team the brand deploy scripts act on (AWTD-1280).
 *
 * scripts/push-brand-env.ts and scripts/deploy-brand-preview.ts used to hardcode
 * Astrid's team id and `--scope gracefultools`, so a partner following
 * docs/WHITELABELING.md could not run them from their own Vercel account. The
 * target now comes from, in order: `--team` / `--scope` flags, the
 * `VERCEL_TEAM_ID` / `VERCEL_SCOPE` environment, then Astrid's values — so
 * with nothing set, behaviour is exactly what it was.
 */

export const ASTRID_VERCEL_TEAM_ID = 'team_gFxp7fWaX7e8tUPt8Vt3YXl0'
export const ASTRID_VERCEL_SCOPE = 'gracefultools'

export interface VercelTarget {
  teamId: string
  scope: string
  /** Astrid's own team, whose previews share Astrid's production database. */
  isAstridTeam: boolean
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function resolveVercelTarget(
  args: readonly string[],
  env: Record<string, string | undefined> = process.env,
): VercelTarget {
  const teamId = flagValue(args, '--team') ?? (env.VERCEL_TEAM_ID || ASTRID_VERCEL_TEAM_ID)
  const scope = flagValue(args, '--scope') ?? (env.VERCEL_SCOPE || ASTRID_VERCEL_SCOPE)
  return { teamId, scope, isAstridTeam: teamId === ASTRID_VERCEL_TEAM_ID || scope === ASTRID_VERCEL_SCOPE }
}

/** The flags resolveVercelTarget consumes, so callers can skip their values when reading positionals. */
export const VERCEL_TARGET_FLAGS = ['--team', '--scope'] as const

/**
 * Variables forced on a brand preview regardless of the profile.
 *
 * On Astrid's team, previews share the production database and agent User rows
 * are created on demand, so a preview at another agent domain would write junk
 * identities into production data — the agent domain is pinned to astrid.cc
 * (brands/README.md). A partner's team has its own database, where the
 * profile's agent domain is the right one, so nothing is pinned.
 */
export function previewPins(target: VercelTarget): Record<string, string> {
  return target.isAstridTeam ? { BRAND_AGENT_EMAIL_DOMAIN: 'astrid.cc' } : {}
}
