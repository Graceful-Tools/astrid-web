import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET } from '@/app/api/users/search/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Mock NextRequest with URL search params
const createMockRequest = (searchParams: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const url = new URL('http://localhost:3000/api/users/search')
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  const request = {
    url: url.toString(),
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null
    }
  } as any as Request
  return request
}

const mockUser = {
  id: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  createdAt: new Date(),
  updatedAt: new Date()
}

const claudeAgent = {
  id: 'claude-agent-id',
  name: 'Claude Code Agent',
  email: 'claude@astrid.cc',
  image: null,
  isAIAgent: true,
  aiAgentType: 'coding_agent',
  isActive: true
}

const openaiAgent = {
  id: 'openai-agent-id',
  name: 'OpenAI Agent',
  email: 'openai@astrid.cc',
  image: null,
  isAIAgent: true,
  aiAgentType: 'coding_agent',
  isActive: true
}

const geminiAgent = {
  id: 'gemini-agent-id',
  name: 'Gemini Agent',
  email: 'gemini@astrid.cc',
  image: null,
  isAIAgent: true,
  aiAgentType: 'gemini_agent',
  isActive: true
}

describe('AI Agent Assignment Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset all prisma mocks completely
    Object.values(mockPrisma.user).forEach((mock: any) => mock.mockReset())
    Object.values(mockPrisma.task).forEach((mock: any) => mock.mockReset())
    Object.values(mockPrisma.taskList).forEach((mock: any) => mock.mockReset())

    // Mock current user authentication
    mockGetServerSession.mockResolvedValue({ user: mockUser })

    // Mock current user exists in database (for the findUnique call)
    mockPrisma.user.findUnique.mockResolvedValue(mockUser)

    // User search now resolves its scope through lib/user-search-scope.ts:
    // `listIds`/`taskId` from the query are filtered down to lists the CALLER
    // belongs to, because this endpoint returns members' email addresses
    // (task e0613ae5). These tests are about which AGENTS come back, not about
    // access control — that is covered in tests/api/user-search-scope-leak.test.ts
    // — so the caller is set up as a member of whatever lists a test asks for,
    // which is the situation the real UI is always in.
    mockPrisma.taskList.findMany.mockImplementation(async (args: any) =>
      (args?.where?.id?.in ?? []).map((id: string) => ({ id })))
    mockPrisma.task.findFirst.mockImplementation((...args: any[]) =>
      (mockPrisma.task.findUnique as any)(...args))
  })

  it('should show no AI agents when none are added to list', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    // Mock the task query to return a task with list associations
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock no AI agents found (they're not list members)
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query (no users are members)
      .mockResolvedValueOnce([]) // For AI agents query (no AI agents are members)

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    // Should not include any AI agents since none are members
    const aiAgents = data.users.filter((user: any) => user.isAIAgent)
    expect(aiAgents.length).toBe(0)
  })

  it('should show only Claude agent when only Claude is added to list', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    // Mock the task query to return a task with list associations
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock only Claude agent found (it's a list member)
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query (no regular users)
      .mockResolvedValueOnce([claudeAgent]) // For AI agents query (Claude is a member)

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should only show Claude agent
    expect(aiAgents.length).toBe(1)
    expect(aiAgents[0].email).toBe('claude@astrid.cc')
    expect(aiAgents[0].name).toBe('Claude Code Agent')
  })

  it('should show only OpenAI agent when only OpenAI is added to list', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    // Mock the task query to return a task with list associations
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock only OpenAI agent found (it's a list member)
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query (no regular users)
      .mockResolvedValueOnce([openaiAgent]) // For AI agents query (OpenAI is a member)

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should only show OpenAI agent
    expect(aiAgents.length).toBe(1)
    expect(aiAgents[0].email).toBe('openai@astrid.cc')
    expect(aiAgents[0].name).toBe('OpenAI Agent')
  })

  it('should show both agents when both are added to list', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    // Mock the task query to return a task with list associations
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock both agents found (they're both list members)
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query (no regular users)
      .mockResolvedValueOnce([claudeAgent, openaiAgent]) // For AI agents query

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should show both agents
    expect(aiAgents.length).toBe(2)

    const emails = aiAgents.map((agent: any) => agent.email)
    expect(emails).toContain('claude@astrid.cc')
    expect(emails).toContain('openai@astrid.cc')
  })

  it('should filter AI agents by search query', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    // Mock the task query to return a task with list associations
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock only Claude agent found when searching for "claude"
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query with search (no regular users)
      .mockResolvedValueOnce([claudeAgent]) // For AI agents query with search

    const request = createMockRequest({ taskId: testTaskId, q: 'claude' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should only show Claude agent when searching for "claude"
    expect(aiAgents.length).toBe(1)
    expect(aiAgents[0].email).toBe('claude@astrid.cc')
  })

  it('should work with listIds parameter', async () => {
    const testListId = 'test-list-id'

    // Mock Claude agent found (it's a list member)
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query (no regular users)
      .mockResolvedValueOnce([claudeAgent]) // For AI agents query

    const request = createMockRequest({ listIds: testListId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should show Claude agent
    expect(aiAgents.length).toBe(1)
    expect(aiAgents[0].email).toBe('claude@astrid.cc')
  })

  it('should show Gemini agent when Gemini is added to list', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    // Mock the task query to return a task with list associations
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock only Gemini agent found (it's a list member)
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query (no regular users)
      .mockResolvedValueOnce([geminiAgent]) // For AI agents query

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should only show Gemini agent
    expect(aiAgents.length).toBe(1)
    expect(aiAgents[0].email).toBe('gemini@astrid.cc')
    expect(aiAgents[0].name).toBe('Gemini Agent')
  })

  it('should show all three agents when all are added to list', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    // Mock the task query to return a task with list associations
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock all agents found (they're all list members)
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query (no regular users)
      .mockResolvedValueOnce([claudeAgent, openaiAgent, geminiAgent]) // For AI agents query

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should show all three agents
    expect(aiAgents.length).toBe(3)

    const emails = aiAgents.map((agent: any) => agent.email)
    expect(emails).toContain('claude@astrid.cc')
    expect(emails).toContain('openai@astrid.cc')
    expect(emails).toContain('gemini@astrid.cc')
  })

  it('should filter Gemini agent by search query', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    // Mock the task query to return a task with list associations
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock only Gemini agent found when searching for "gemini"
    mockPrisma.user.findMany
      .mockResolvedValueOnce([]) // For list members query with search (no regular users)
      .mockResolvedValueOnce([geminiAgent]) // For AI agents query with search

    const request = createMockRequest({ taskId: testTaskId, q: 'gemini' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should only show Gemini agent when searching for "gemini"
    expect(aiAgents.length).toBe(1)
    expect(aiAgents[0].email).toBe('gemini@astrid.cc')
  })
})

// ============================================================================
// NON-CODING FLOW TESTS
// These tests ensure agent assignment works correctly for non-coding tasks
// ============================================================================

describe('AI Agent Assignment - Non-Coding Flows', () => {
  const regularUser1 = {
    id: 'user-1',
    name: 'John Doe',
    email: 'john@example.com',
    image: null,
    isAIAgent: false,
    aiAgentType: null,
    isActive: true
  }

  const regularUser2 = {
    id: 'user-2',
    name: 'Jane Smith',
    email: 'jane@example.com',
    image: null,
    isAIAgent: false,
    aiAgentType: null,
    isActive: true
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset all prisma mocks completely
    Object.values(mockPrisma.user).forEach((mock: any) => mock.mockReset())
    Object.values(mockPrisma.task).forEach((mock: any) => mock.mockReset())
    Object.values(mockPrisma.taskList).forEach((mock: any) => mock.mockReset())

    // Mock current user authentication
    mockGetServerSession.mockResolvedValue({ user: mockUser })

    // Mock current user exists in database
    mockPrisma.user.findUnique.mockResolvedValue(mockUser)

    // See the note in the first describe: search scope is now filtered to the
    // caller's own lists (task e0613ae5), so the caller is set up as a member
    // of whatever lists a test asks for.
    mockPrisma.taskList.findMany.mockImplementation(async (args: any) =>
      (args?.where?.id?.in ?? []).map((id: string) => ({ id })))
    mockPrisma.task.findFirst.mockImplementation((...args: any[]) =>
      (mockPrisma.task.findUnique as any)(...args))
  })

  it('should show regular users alongside AI agents', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Mock regular users and AI agent together
    mockPrisma.user.findMany
      .mockResolvedValueOnce([regularUser1, regularUser2]) // Regular users
      .mockResolvedValueOnce([claudeAgent]) // AI agent

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    // Note: Results may include the current user as well
    const aiAgents = data.users.filter((user: any) => user.isAIAgent)
    const regularUsers = data.users.filter((user: any) => !user.isAIAgent)

    // Should have at least the expected agents and users
    expect(aiAgents.length).toBe(1)
    expect(regularUsers.length).toBeGreaterThanOrEqual(2)
  })

  it('should handle task with no associated lists gracefully', async () => {
    const testTaskId = 'task-no-lists'

    // Task exists but has no lists
    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: []
    })

    // No users when no lists
    mockPrisma.user.findMany.mockResolvedValue([])

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    // Should return empty results, not error
    expect(data.users).toBeDefined()
    expect(Array.isArray(data.users)).toBe(true)
  })

  it('should handle task that does not exist', async () => {
    const testTaskId = 'non-existent-task'

    // Task doesn't exist
    mockPrisma.task.findUnique.mockResolvedValue(null)
    mockPrisma.user.findMany.mockResolvedValue([])

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    // Should return empty results, not error
    expect(data.users).toBeDefined()
    expect(Array.isArray(data.users)).toBe(true)
  })

  it('should show only regular users when no AI agents are members', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Only regular users in the list
    mockPrisma.user.findMany
      .mockResolvedValueOnce([regularUser1, regularUser2])
      .mockResolvedValueOnce([]) // No AI agents

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    // Should show only regular users (plus possibly the current user)
    const aiAgents = data.users.filter((user: any) => user.isAIAgent)
    const regularUsers = data.users.filter((user: any) => !user.isAIAgent)

    expect(aiAgents.length).toBe(0)
    expect(regularUsers.length).toBeGreaterThanOrEqual(2)
  })

  it('should handle empty search query with multiple lists', async () => {
    const testTaskId = 'test-task-id'

    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: 'list-1' }, { id: 'list-2' }, { id: 'list-3' }]
    })

    mockPrisma.user.findMany
      .mockResolvedValueOnce([regularUser1])
      .mockResolvedValueOnce([claudeAgent, openaiAgent])

    const request = createMockRequest({ taskId: testTaskId, q: '' })
    const response = await GET(request)
    const data = await response.json()

    // Should aggregate users from all lists
    const aiAgents = data.users.filter((user: any) => user.isAIAgent)
    const regularUsers = data.users.filter((user: any) => !user.isAIAgent)

    // Should have the expected AI agents and at least 1 regular user
    expect(aiAgents.length).toBe(2)
    expect(regularUsers.length).toBeGreaterThanOrEqual(1)
  })

  it('should not duplicate AI agents when searching by partial name', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Search for "agent" should match all AI agents
    mockPrisma.user.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claudeAgent, openaiAgent, geminiAgent])

    const request = createMockRequest({ taskId: testTaskId, q: 'agent' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)

    // Should show all matching agents without duplicates
    expect(aiAgents.length).toBe(3)

    // Verify no duplicates by checking unique emails
    const emails = aiAgents.map((a: any) => a.email)
    const uniqueEmails = [...new Set(emails)]
    expect(uniqueEmails.length).toBe(3)
  })

  it('should handle case-insensitive search', async () => {
    const testTaskId = 'test-task-id'
    const testListId = 'test-list-id'

    mockPrisma.task.findUnique.mockResolvedValue({
      id: testTaskId,
      lists: [{ id: testListId }]
    })

    // Search for "CLAUDE" (uppercase) should find claude agent
    mockPrisma.user.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claudeAgent])

    const request = createMockRequest({ taskId: testTaskId, q: 'CLAUDE' })
    const response = await GET(request)
    const data = await response.json()

    const aiAgents = data.users.filter((user: any) => user.isAIAgent)
    expect(aiAgents.length).toBe(1)
    expect(aiAgents[0].email).toBe('claude@astrid.cc')
  })
})