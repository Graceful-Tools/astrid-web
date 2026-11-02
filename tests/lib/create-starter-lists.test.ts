/**
 * "Create my lists" on /starthere — the five blueprint lists, each with its
 * agent as default assignee, created idempotently through the v1 API.
 */

import { describe, expect, it } from 'vitest'

import { agentEmail } from '@/lib/brand/agent-emails'
import { STARTER_LISTS } from '@/lib/start-here/business-blueprint'
import { createStarterLists, type StarterApi } from '@/lib/start-here/create-starter-lists'

function fakeApi(opts: {
  existing?: { id: string; name: string; isVirtual?: boolean }[]
  agents?: string[]
  failOn?: string
}) {
  const posts: Record<string, unknown>[] = []
  const api: StarterApi = {
    async getJson(path) {
      if (path === '/api/v1/lists') return { ok: true, status: 200, body: { lists: opts.existing ?? [] } }
      if (path === '/api/v1/users/me/available-agents') {
        return {
          ok: true,
          status: 200,
          body: { agents: (opts.agents ?? []).map(m => ({ id: `user-${m}`, email: agentEmail(m) })) },
        }
      }
      return { ok: false, status: 404, body: null }
    },
    async postJson(_path, body) {
      const b = body as Record<string, unknown>
      posts.push(b)
      if (b.name === opts.failOn) return { ok: false, status: 403, body: { error: 'nope' } }
      return { ok: true, status: 201, body: { list: { id: `list-${String(b.name).toLowerCase()}` } } }
    },
  }
  return { api, posts }
}

describe('createStarterLists', () => {
  it('creates every blueprint list with its description and agent as default assignee', async () => {
    const { api, posts } = fakeApi({ agents: ['muse', 'claude', 'codex', 'copilot'] })
    const results = await createStarterLists(api)

    expect(results.map(r => r.name)).toEqual(STARTER_LISTS.map(l => l.name))
    expect(results.every(r => r.created)).toBe(true)
    expect(posts).toHaveLength(STARTER_LISTS.length)
    for (const list of STARTER_LISTS) {
      const post = posts.find(p => p.name === list.name)!
      expect(post.description).toBe(list.description)
      expect(post.privacy).toBe('PRIVATE')
    }
    expect(posts.find(p => p.name === 'Plan')!.defaultAssigneeId).toBe('user-muse')
    expect(posts.find(p => p.name === 'Build')!.defaultAssigneeId).toBe('user-claude')
    expect(posts.find(p => p.name === 'Fix')!.defaultAssigneeId).toBe('user-codex')
    expect(posts.find(p => p.name === 'Review')!.defaultAssigneeId).toBe('user-copilot')
    // GitHub Actions works the Automations list as the copilot mailbox.
    expect(posts.find(p => p.name === 'Automations')!.defaultAssigneeId).toBe('user-copilot')
  })

  it('reuses lists that already exist by name, so pressing twice never duplicates', async () => {
    const { api, posts } = fakeApi({
      existing: [{ id: 'mine-build', name: ' build ' }, { id: 'filter', name: 'Fix', isVirtual: true }],
      agents: ['claude'],
    })
    const results = await createStarterLists(api)

    expect(results.find(r => r.key === 'build')).toMatchObject({ id: 'mine-build', created: false })
    // A saved filter named "Fix" is not a list you can put tasks in.
    expect(results.find(r => r.key === 'fix')).toMatchObject({ created: true })
    expect(posts.map(p => p.name)).not.toContain('Build')
  })

  it('still creates a list when its agent is not available, just without a default assignee', async () => {
    const { api, posts } = fakeApi({ agents: [] })
    await createStarterLists(api)
    expect(posts.every(p => !('defaultAssigneeId' in p))).toBe(true)
  })

  it('fails visibly instead of reporting success when a create is refused', async () => {
    const { api } = fakeApi({ failOn: 'Fix' })
    await expect(createStarterLists(api)).rejects.toThrow(/Fix list \(HTTP 403\)/)
  })
})
