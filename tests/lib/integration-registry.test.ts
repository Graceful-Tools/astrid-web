import { describe, expect, it } from 'vitest'

import { GET as getLlmsTxt } from '@/app/llms.txt/route'
import { enabledIntegrationMethods } from '@/lib/integration-registry'

describe('coding-agent integration discovery (AWTD-757)', () => {
  it('leads the integration index with the queue workflow while preserving the MCP registry id', () => {
    const [codingAgent, ...otherMethods] = enabledIntegrationMethods()

    expect(codingAgent).toMatchObject({
      id: 'mcp',
      name: 'Connect my coding agent',
      docsPath: '/docs/loops',
    })
    expect(codingAgent.tagline).toMatch(/assigned.*Ready.*queue/i)
    expect(otherMethods.map(method => method.name)).not.toContain('MCP (Model Context Protocol)')
  })

  it('directs LLMs to the coding-agent queue workflow without requiring protocol vocabulary', async () => {
    const content = await (await getLlmsTxt()).text()
    const codingAgentIndex = content.indexOf('[Connect my coding agent]')
    const restApiIndex = content.indexOf('[REST API]')

    expect(codingAgentIndex).toBeGreaterThan(-1)
    expect(codingAgentIndex).toBeLessThan(restApiIndex)
    expect(content).toContain('/docs/loops')
    expect(content).toMatch(/assign.*Ready.*get_agent_queue/is)
    expect(content).not.toContain('[MCP (Model Context Protocol)]')
  })
})
