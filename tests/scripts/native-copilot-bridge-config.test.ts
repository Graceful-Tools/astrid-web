/**
 * ADEV-102 — the native Copilot bridge's entry script hardcoded the owner's
 * repository and origin, so a third-party board's bridge assigned issues in
 * Graceful-Tools/astrid-web and talked to astrid.cc. Its target now comes from
 * the run: GITHUB_REPOSITORY (set by Actions), the canonical API origin, and
 * the explicit board from --list or ASTRID_OAUTH_LIST_ID.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveBridgeConfig } from '@/scripts/lib/native-copilot-bridge'
import { mcpDefaultBaseUrl } from '@/lib/brand/config'

afterEach(() => vi.unstubAllEnvs())

describe('resolveBridgeConfig (ADEV-102)', () => {
  it('ADEV-102: targets the repository the workflow runs in, not the owner repo', () => {
    const config = resolveBridgeConfig({ GITHUB_REPOSITORY: 'partner-org/partner-app' }, ['--list', 'list-1'])
    expect(config.repo).toBe('partner-org/partner-app')
    expect(config.listId).toBe('list-1')
  })

  it('ADEV-102: keeps the owner repository as the default outside Actions', () => {
    expect(resolveBridgeConfig({}, ['--list', 'list-1']).repo).toBe('Graceful-Tools/astrid-web')
  })

  it('ADEV-102: rejects a malformed repository instead of assigning issues somewhere odd', () => {
    expect(() => resolveBridgeConfig({ GITHUB_REPOSITORY: 'not a repo' }, ['--list', 'l'])).toThrow(/GITHUB_REPOSITORY/)
  })

  it('ADEV-102: talks to the canonical API origin, overridable for a partner deployment', () => {
    vi.stubEnv('ASTRID_API_BASE_URL', '')
    expect(resolveBridgeConfig({}, ['--list', 'l']).origin).toBe(mcpDefaultBaseUrl())
    expect(resolveBridgeConfig({ ASTRID_API_URL: 'https://tasks.partner.test/' }, ['--list', 'l']).origin)
      .toBe('https://tasks.partner.test')
    vi.stubEnv('ASTRID_API_BASE_URL', 'https://base.partner.test')
    expect(resolveBridgeConfig({}, ['--list', 'l']).origin).toBe('https://base.partner.test')
  })

  it('ADEV-102: reads the board from --list, else ASTRID_OAUTH_LIST_ID, and refuses to guess one', () => {
    expect(resolveBridgeConfig({ ASTRID_OAUTH_LIST_ID: 'env-list' }, []).listId).toBe('env-list')
    expect(resolveBridgeConfig({ ASTRID_OAUTH_LIST_ID: 'env-list' }, ['--list', 'flag-list']).listId).toBe('flag-list')
    expect(() => resolveBridgeConfig({ ASTRID_OAUTH_LIST_ID: '' }, [])).toThrow(/--list/)
    expect(() => resolveBridgeConfig({}, ['--list', '--execute'])).toThrow(/--list/)
  })
})
