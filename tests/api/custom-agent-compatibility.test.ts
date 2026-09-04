import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Custom Agent compatibility aliases (AWTD-761)', () => {
  it('keeps every OpenClaw route wired to the canonical Custom Agent handler', async () => {
    const customRegister = await import('@/app/api/v1/custom-agents/register/route')
    const openClawRegister = await import('@/app/api/v1/openclaw/register/route')
    const customAgents = await import('@/app/api/v1/custom-agents/agents/route')
    const openClawAgents = await import('@/app/api/v1/openclaw/agents/route')
    const customAgent = await import('@/app/api/v1/custom-agents/agents/[id]/route')
    const openClawAgent = await import('@/app/api/v1/openclaw/agents/[id]/route')

    expect(openClawRegister.POST).toBe(customRegister.POST)
    expect(openClawAgents.GET).toBe(customAgents.GET)
    expect(openClawAgent.PATCH).toBe(customAgent.PATCH)
    expect(openClawAgent.DELETE).toBe(customAgent.DELETE)
  })

  it('publishes a generic capability without changing the legacy capability value', async () => {
    const { CAPABILITIES } = await import('@/lib/brand/capabilities')
    const { GET } = await import('@/app/api/v1/capabilities/route')
    const body = await (await GET()).json()

    expect(CAPABILITIES.integrationCustomAgents).toBe(CAPABILITIES.integrationOpenClaw)
    expect(body.integrations.customAgents).toBe(body.integrations.openclaw)
  })

  it('advertises Custom Agents instead of exposing OpenClaw as the product abstraction', async () => {
    const { enabledIntegrationMethods } = await import('@/lib/integration-registry')
    const integrations = enabledIntegrationMethods()

    expect(integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-agents',
          name: 'Custom Agents',
          docsPath: '/docs/custom-agents',
        }),
      ])
    )
    expect(integrations.map((integration) => integration.id)).not.toContain('openclaw')
  })

  it('keeps the old documentation URL as a redirect to the generic guide', () => {
    const redirectPage = readFileSync(
      join(root, 'app/[locale]/docs/openclaw/page.tsx'),
      'utf8'
    )
    const customAgentPage = readFileSync(
      join(root, 'app/[locale]/docs/custom-agents/page.tsx'),
      'utf8'
    )

    expect(redirectPage).toContain("permanentRedirect('/docs/custom-agents')")
    expect(customAgentPage).toContain('Custom Agent Protocol')
    expect(customAgentPage).toContain('.oc@')
  })

  it('does not retain the orphaned signing module or nonexistent public-key contract', () => {
    expect(existsSync(join(root, 'lib/ai/openclaw-signing.ts'))).toBe(false)
    expect(existsSync(join(root, 'app/.well-known/openclaw-public-key/route.ts'))).toBe(false)

    for (const path of [
      'app/[locale]/docs/custom-agents/page.tsx',
      'components/custom-agent-manager.tsx',
      'lib/i18n/locales/en.json',
    ]) {
      expect(readFileSync(join(root, path), 'utf8')).not.toContain('openclaw-public-key')
    }
  })
})
