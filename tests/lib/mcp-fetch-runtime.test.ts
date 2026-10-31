/**
 * @vitest-environment node
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('AITD-447 hosted MCP dispatcher runtime compatibility', () => {
  it('fetches a fixture backend with its pinned transport outside Vitest mocks', () => {
    const script = `
      import { createServer } from 'node:http';
      import { fetchMCPBackend } from './lib/security/mcp-backend.ts';
      const server = createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ fixture: true }));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        process.env.ASTRID_API_BASE_URL = base;
        const response = await fetchMCPBackend(base, '/api/v1/lists');
        if (response.status !== 200 || !(await response.json()).fixture) {
          throw new Error('Fixture backend response was not preserved');
        }
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    `
    expect(() => execFileSync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '-e', script,
    ], { encoding: 'utf8', stdio: 'pipe', timeout: 30_000 })).not.toThrow()
  })
})
