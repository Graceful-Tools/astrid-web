/**
 * @vitest-environment node
 */
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMCPBackend } from '@/lib/security/mcp-backend'

afterEach(() => vi.unstubAllEnvs())

describe('AITD-447 hosted MCP real transport redirects', () => {
  it.each([301, 302, 303, 307, 308])('never follows HTTP %s with fixture credentials', async status => {
    let destinationHits = 0
    const server = createServer((req, res) => {
      if (req.url === '/destination') {
        destinationHits += 1
        res.end('fixture')
      } else {
        res.writeHead(status, { Location: '/destination' })
        res.end()
      }
    })
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      const backend = `http://127.0.0.1:${address.port}`
      // This exception is operator configuration, not an inbound request override.
      vi.stubEnv('ASTRID_API_BASE_URL', backend)
      for (const endpoint of ['/api/v1/oauth/validate', '/api/v1/oauth/token', '/api/v1/lists']) {
        await expect(fetchMCPBackend(backend, endpoint, {
          method: endpoint.endsWith('/token') ? 'POST' : 'GET',
          headers: { Authorization: 'Bearer fixture-not-real' },
        })).rejects.toThrow()
      }
      expect(destinationHits).toBe(0)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
