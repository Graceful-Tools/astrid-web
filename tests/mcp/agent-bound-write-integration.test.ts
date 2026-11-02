import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/v1/tasks/[id]/comments/route'
import { agentEmail } from '@/lib/brand/agent-emails'
import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { createCommentWithSideEffects } from '@/services/comment.service'
import { rowWith } from '../fixtures/prisma-rows'
import { mockGetServerSession, mockPrisma } from '../setup'

vi.mock('@/services/comment.service', () => ({ createCommentWithSideEffects: vi.fn() }))
vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { COMMENT_ADDED: 'COMMENT_ADDED' },
  trackEventFromRequest: vi.fn(),
}))

const TOKEN = 'astrid_mcp_test'
const TASK_ID = 'task-id'
const OWNER = { id: 'owner-id', email: 'owner@example.com', name: 'Owner', isAIAgent: false }
const COPILOT = { id: 'copilot-id', email: agentEmail('copilot'), name: 'GitHub Copilot Agent', isAIAgent: true }
const mockCreateComment = vi.mocked(createCommentWithSideEffects)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ASTRID_AGENT_ID', '')
  vi.stubEnv('ASTRID_AGENT_ID_COPILOT', '')
  mockGetServerSession.mockResolvedValue(null)
  mockPrisma.task.findUnique.mockResolvedValue(rowWith({
    id: TASK_ID,
    title: 'Smoke task',
    creatorId: OWNER.id,
    assigneeId: null,
    assignee: null,
    lists: [],
  }))
  mockCreateComment.mockResolvedValue({
    kind: 'created',
    comment: { id: 'comment-id', authorId: COPILOT.id },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('MCP writes through access-token authentication (AWTD-1383)', () => {
  it.each([
    { name: 'the bound agent', agentUser: COPILOT, queueAgentId: COPILOT.id, error: null },
    {
      name: 'an unbound token',
      agentUser: null,
      queueAgentId: COPILOT.id,
      error: 'aiAgentId cannot be selected by the caller; use an agent-bound credential',
    },
    {
      name: 'a different declared agent',
      agentUser: COPILOT,
      queueAgentId: 'different-agent',
      error: 'aiAgentId does not match the agent-bound credential',
    },
  ])('handles $name without changing the authenticated author', async ({ agentUser, queueAgentId, error }) => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue(rowWith({
      id: 'token-id',
      userId: OWNER.id,
      user: OWNER,
      agentUser,
      agentMailbox: agentUser ? 'copilot' : null,
      permissions: ['read', 'write'],
    }))
    const fetchBackend = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('/api/v1/agent-queue?')) {
        return Response.json({ agent: { mailbox: 'copilot', id: queueAgentId } })
      }
      if (url.endsWith(`/api/v1/tasks/${TASK_ID}/comments`)) {
        const request = new NextRequest(url, {
          method: init?.method,
          headers: init?.headers,
          body: init?.body,
        })
        return POST(request, { params: Promise.resolve({ id: TASK_ID }) })
      }
      throw new Error(`Unexpected backend request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchBackend)

    const server = new AstridMCPServerOAuth({ baseUrl: 'https://astrid.test', accessToken: TOKEN })
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.startWithTransport(serverTransport)
    await client.connect(clientTransport)

    try {
      const result = await client.callTool({
        name: 'add_comment',
        arguments: { taskId: TASK_ID, content: 'Handback question', agent: 'copilot' },
      })

      expect(mockPrisma.mCPToken.findFirst).toHaveBeenCalled()
      if (error) {
        expect(result.isError).toBe(true)
        expect(result.content).toEqual(expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining(error) }),
        ]))
        expect(mockCreateComment).not.toHaveBeenCalled()
      } else {
        expect(result.isError).toBeFalsy()
        expect(mockCreateComment).toHaveBeenCalledWith(
          expect.objectContaining({ authorId: COPILOT.id, content: 'Handback question' }),
        )
      }
    } finally {
      await client.close()
    }
  })
})
