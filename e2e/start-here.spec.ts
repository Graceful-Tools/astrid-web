/**
 * /starthere, end to end, as each agent would follow it.
 *
 * An agent handed "go to astrid.cc/starthere" reads /starthere.md, runs its
 * section's connect command, and its harness then does the MCP OAuth dance:
 * POST /mcp → 401 + resource_metadata → protected-resource metadata →
 * authorization-server metadata → dynamic client registration. The GitHub
 * Actions path instead exchanges client credentials at /api/v1/oauth/token and
 * reads /api/v1/agent-queue. These tests walk exactly those hops on the live
 * server for every agent in the guide, unauthenticated — so a broken hop is
 * caught before an agent hits it. The authenticated half (lists created, a
 * task queued for each mailbox) is e2e/start-here-authenticated.spec.ts.
 */

import { expect, test, type APIRequestContext } from '@playwright/test'

const AGENTS = [
  { name: 'Muse Agent', key: 'muse', mailbox: 'muse', connect: /^muse mcp add \S+ --url (\S+)\/mcp$/m },
  { name: 'Claude', key: 'claude', mailbox: 'claude', connect: /^claude mcp add --transport http \S+ (\S+)\/mcp$/m },
  { name: 'Codex', key: 'codex', mailbox: 'codex', connect: /^codex mcp add \S+ --url (\S+)\/mcp$/m },
  { name: 'GitHub Copilot', key: 'copilot', mailbox: 'copilot', connect: /^copilot mcp add --transport http \S+ (\S+)\/mcp$/m },
] as const

/** One agent's section of the markdown, fence-aware. */
function sectionFor(markdown: string, agentName: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex(l => l.startsWith(`### ${agentName} →`))
  expect(start, `no section for ${agentName}`).toBeGreaterThan(-1)
  let inFence = false
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('```')) inFence = !inFence
    if (!inFence && /^#{2,3} /.test(lines[i])) return lines.slice(start, i).join('\n')
  }
  return lines.slice(start).join('\n')
}

async function guide(request: APIRequestContext): Promise<string> {
  const res = await request.get('/starthere.md')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('text/markdown')
  return res.text()
}

/** Walk the MCP OAuth discovery an MCP client performs after `mcp add`. */
async function walkMcpDiscovery(request: APIRequestContext, mcpPath: string) {
  const unauth = await request.post(mcpPath, {
    data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    headers: { Accept: 'application/json, text/event-stream' },
    maxRedirects: 0,
  })
  expect(unauth.status(), 'MCP must challenge, not redirect or 404').toBe(401)
  const challenge = unauth.headers()['www-authenticate'] ?? ''
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1]
  expect(metadataUrl, `WWW-Authenticate: ${challenge}`).toBeTruthy()

  const resource = await request.get(new URL(metadataUrl!).pathname)
  expect(resource.status()).toBe(200)
  const resourceJson = await resource.json()
  expect(resourceJson.resource).toMatch(/\/mcp$/)
  expect(resourceJson.authorization_servers?.length).toBeGreaterThan(0)

  const as = await request.get('/.well-known/oauth-authorization-server')
  expect(as.status()).toBe(200)
  const asJson = await as.json()
  for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    expect(asJson[key], key).toBeTruthy()
  }

  // Dynamic client registration is what `mcp login` / Authenticate calls
  // first. Probed with empty metadata so the run never mints a client row:
  // an RFC 7591 endpoint answers invalid_client_metadata, a missing one 404s.
  const register = await request.post(new URL(asJson.registration_endpoint).pathname, { data: {} })
  expect(register.status(), await register.text()).toBe(400)
  expect((await register.json()).error).toBe('invalid_client_metadata')
}

test.describe('/starthere page', () => {
  test('shows the shape, every step and every agent with its own commands', async ({ page }) => {
    await page.goto('/starthere')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Run your software business with agents')
    await expect(page.getByTestId('starthere-shape')).toContainText('Plan')
    for (const n of [1, 2, 3, 4]) await expect(page.getByTestId(`starthere-step-${n}`)).toBeVisible()

    for (const agent of [...AGENTS, { key: 'github-actions' }]) {
      const card = page.getByTestId(`starthere-agent-${agent.key}`)
      await expect(card).toBeVisible()
      await card.locator('summary').click()
    }
    for (const agent of AGENTS) {
      await expect(page.getByTestId(`starthere-connect-${agent.key}`)).toHaveText(agent.connect)
      // Claude Code's cron runs the installed /astrid-queue command; the others
      // carry the queue contract with their own mailbox inline.
      await expect(page.getByTestId(`starthere-schedule-${agent.key}`)).toContainText(
        agent.key === 'claude' ? 'claude -p' : `agent "${agent.mailbox}"`,
      )
    }
    await expect(page.getByTestId('starthere-workflow-github-actions')).toContainText('/api/v1/agent-queue?agent=copilot')
    // AWTD-1494: Claude can also run in GitHub Actions on the user's plan.
    await expect(page.getByTestId('starthere-hosted-claude')).toBeVisible()
    await expect(page.getByTestId('starthere-hosted-workflow-claude')).toContainText('anthropics/claude-code-action@v1')
    await expect(page.getByTestId('starthere-markdown-link')).toHaveAttribute('href', '/starthere.md')
  })

  test('asks a signed-out reader to sign in before creating lists', async ({ page }) => {
    await page.goto('/starthere')
    await expect(page.getByRole('button', { name: /sign in to create them/i })).toBeVisible()
    await expect(page.getByTestId('starthere-create-lists')).toHaveCount(0)
  })

  test('is discoverable from llms.txt', async ({ request }) => {
    const res = await request.get('/llms.txt')
    expect(await res.text()).toContain('/starthere.md')
  })
})

test.describe('/starthere.md followed by each agent', () => {
  for (const agent of AGENTS) {
    test(`${agent.name}: connect command reaches a working MCP OAuth flow`, async ({ request, baseURL }) => {
      const section = sectionFor(await guide(request), agent.name)
      const origin = agent.connect.exec(section)?.[1]
      expect(origin, `${agent.name} section has no connect command`).toBeTruthy()
      // The guide must point the agent at THIS server, not a hardcoded host.
      expect(new URL(origin!).host).toBe(new URL(baseURL!).host)

      expect(section).toContain(`agent "${agent.mailbox}"`)
      await walkMcpDiscovery(request, '/mcp')
    })
  }

  test('GitHub Actions: the workflow\'s token and queue endpoints exist and refuse bad credentials', async ({ request }) => {
    const section = sectionFor(await guide(request), 'GitHub Actions')
    expect(section).toContain('.github/workflows/')
    expect(section).toContain('cron: "*/30 * * * *"')

    const token = await request.post('/api/v1/oauth/token', {
      form: { grant_type: 'client_credentials', client_id: 'starthere-probe', client_secret: 'wrong' },
    })
    expect([400, 401]).toContain(token.status())

    const queue = await request.get('/api/v1/agent-queue?agent=copilot')
    expect(queue.status()).toBe(401)
  })

  test('Claude in GitHub Actions: the gate\'s bearer request reaches the queue and is refused only for a bad token (AWTD-1494)', async ({ request }) => {
    const section = sectionFor(await guide(request), 'Claude')
    expect(section).toContain('anthropics/claude-code-action@v1')
    const url = /curl -fsS "(https?:\/\/[^"]+\/api\/v1\/agent-queue\?agent=claude[^"]*)"/.exec(section)?.[1]
    expect(url, 'gate curl not found in the Claude section').toBeTruthy()
    const queue = await request.get(new URL(url!).pathname + '?agent=claude', {
      headers: { Authorization: 'Bearer astrid_mcp_not_a_real_token' },
    })
    expect(queue.status()).toBe(401)
  })
})
