import { beforeEach, describe, expect, it, vi } from 'vitest'
import AstridMCPServerOAuth, { OAUTH_MCP_TOOLS } from '@/mcp/mcp-server-oauth'

/**
 * The two ways the OAuth MCP server's task writes lied to their callers.
 *
 * Both bugs were silent — `success: true` came back either way — which is why
 * they survived: an agent following the advertised tool schema had nothing to
 * notice.
 */

const WEB_BOARD = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba'

function stubFetch(json: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => json })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0) {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body)
}

describe('MCP create_task list attachment (task 86b5fbbf)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends listIds, the key POST /api/v1/tasks actually reads', async () => {
    // The bug: the body carried `listId`, which that route never looks at, so
    // the task was created attached to no list at all — an orphan, invisible
    // on every board and findable only by id.
    const fetchMock = stubFetch({ task: { id: 'task-1' } })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    await (server as any).createTask({ listId: WEB_BOARD, title: 'Filed through MCP' })

    const body = bodyOf(fetchMock)
    expect(body.listIds).toEqual([WEB_BOARD])
    expect(body).not.toHaveProperty('listId')
  })

  it('accepts a listIds array for callers that want more than one list', async () => {
    const fetchMock = stubFetch({ task: { id: 'task-1' } })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    await (server as any).createTask({ listIds: [WEB_BOARD, 'list-2'], title: 'Two boards' })

    expect(bodyOf(fetchMock).listIds).toEqual([WEB_BOARD, 'list-2'])
  })

  it('refuses the create when no list resolves, rather than filing an orphan', async () => {
    const fetchMock = stubFetch({ task: { id: 'task-1' } })
    // An explicit null still falls through to the env var, so blank it: the
    // point of the test is the no-list-anywhere case.
    vi.stubEnv('ASTRID_OAUTH_LIST_ID', '')
    const server = new AstridMCPServerOAuth({
      accessToken: 'astrid_mcp_test',
      defaultListId: null,
    })

    await expect((server as any).createTask({ title: 'Nowhere' })).rejects.toThrow(/list/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('MCP repeating task fields (task ee44bc35)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const weekly = {
    type: 'custom',
    unit: 'weeks',
    interval: 1,
    endCondition: 'never',
    weekdays: ['monday'],
  }

  it('passes repeating, repeatingData and repeatFrom through create_task', async () => {
    const fetchMock = stubFetch({ task: { id: 'task-1' } })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    await (server as any).createTask({
      listId: WEB_BOARD,
      title: 'Weekly deep review',
      repeating: 'custom',
      repeatingData: weekly,
      repeatFrom: 'DUE_DATE',
    })

    const body = bodyOf(fetchMock)
    expect(body.repeating).toBe('custom')
    expect(body.repeatingData).toEqual(weekly)
    // Repeat-from-due-date is the point for scheduled work: a late run must
    // not drag the slot forward.
    expect(body.repeatFrom).toBe('DUE_DATE')
  })

  it('passes repeating, repeatingData and repeatFrom through update_task', async () => {
    const fetchMock = stubFetch({ task: { id: 'task-1' } })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    await (server as any).updateTask({
      taskId: 'task-1',
      repeating: 'weekly',
      repeatingData: null,
      repeatFrom: 'DUE_DATE',
    })

    const body = bodyOf(fetchMock)
    expect(body.repeating).toBe('weekly')
    expect(body.repeatFrom).toBe('DUE_DATE')
  })

  it('advertises the repeating fields on both tool schemas', async () => {
    // A field the handler forwards but the schema hides is a field no agent
    // will ever send. docs/FIXALL_WORKFLOW.md names a repeating Astrid task as
    // the sanctioned alternative to a cron, so the schema is the contract.
    const byName = Object.fromEntries(OAUTH_MCP_TOOLS.map((t: any) => [t.name, t]))

    for (const name of ['create_task', 'update_task']) {
      const props = (byName[name] as any).inputSchema.properties
      expect(Object.keys(props)).toEqual(
        expect.arrayContaining(['repeating', 'repeatingData', 'repeatFrom']),
      )
    }
    expect(Object.keys((byName.create_task as any).inputSchema.properties)).toContain('listIds')
  })
})
