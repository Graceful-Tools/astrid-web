/**
 * AWTD-1280 — the white-label deploy scripts were hardwired to Astrid's Vercel
 * team (`team_gFxp…`, `--scope gracefultools`) and pinned every preview's agent
 * domain to astrid.cc, so a partner following docs/WHITELABELING.md could not
 * run them from their own Vercel account, and would have pinned their own
 * database's agent rows to Astrid's domain if they had.
 *
 * The defaults must not move: with nothing set, the target is exactly today's.
 */
import { describe, expect, it } from 'vitest'
import {
  ASTRID_VERCEL_SCOPE,
  ASTRID_VERCEL_TEAM_ID,
  previewPins,
  resolveVercelTarget,
} from '../../scripts/lib/vercel-target'

describe('resolveVercelTarget (AWTD-1280)', () => {
  it('defaults to Astrid’s team when nothing is set — hosted Astrid is unchanged', () => {
    expect(resolveVercelTarget([], {})).toEqual({
      teamId: ASTRID_VERCEL_TEAM_ID,
      scope: ASTRID_VERCEL_SCOPE,
      isAstridTeam: true,
    })
    expect(ASTRID_VERCEL_TEAM_ID).toBe('team_gFxp7fWaX7e8tUPt8Vt3YXl0')
    expect(ASTRID_VERCEL_SCOPE).toBe('gracefultools')
  })

  it('reads VERCEL_TEAM_ID / VERCEL_SCOPE from the environment', () => {
    expect(resolveVercelTarget([], { VERCEL_TEAM_ID: 'team_partner', VERCEL_SCOPE: 'partner-co' })).toEqual({
      teamId: 'team_partner',
      scope: 'partner-co',
      isAstridTeam: false,
    })
  })

  it('lets --team / --scope flags override the environment', () => {
    const target = resolveVercelTarget(
      ['acme', '--team', 'team_flag', '--scope', 'flag-co'],
      { VERCEL_TEAM_ID: 'team_env', VERCEL_SCOPE: 'env-co' },
    )
    expect(target).toEqual({ teamId: 'team_flag', scope: 'flag-co', isAstridTeam: false })
  })

  it('treats either the team id or the scope naming Astrid as Astrid’s team', () => {
    expect(resolveVercelTarget(['--scope', ASTRID_VERCEL_SCOPE], { VERCEL_TEAM_ID: 'team_other' }).isAstridTeam).toBe(true)
    expect(resolveVercelTarget(['--team', ASTRID_VERCEL_TEAM_ID], { VERCEL_SCOPE: 'other' }).isAstridTeam).toBe(true)
  })

  it('refuses a flag with no value rather than swallowing the next flag', () => {
    expect(() => resolveVercelTarget(['--team', '--scope', 'x'], {})).toThrow(/--team requires a value/)
    expect(() => resolveVercelTarget(['--scope'], {})).toThrow(/--scope requires a value/)
  })
})

describe('previewPins (AWTD-1280)', () => {
  it('pins agent identities to astrid.cc on Astrid’s team, whose previews share the production database', () => {
    expect(previewPins(resolveVercelTarget([], {}))).toEqual({ BRAND_AGENT_EMAIL_DOMAIN: 'astrid.cc' })
  })

  it('pins nothing on a partner’s own team — their database, their agent domain', () => {
    expect(previewPins(resolveVercelTarget(['--scope', 'partner-co', '--team', 'team_p'], {}))).toEqual({})
  })
})
