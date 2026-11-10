import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { observeAgentExecutionMode } from '@/lib/ai/agent-execution-mode-shadow'

const { info, warn, deferred } = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  deferred: [] as Array<() => Promise<unknown>>,
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info, warn, debug: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/background', () => ({
  runAfterResponse: (_label: string, work: () => Promise<unknown>) => { deferred.push(work) },
}))

describe('AWTD-1554 execution-mode shadow', () => {
  beforeEach(() => {
    info.mockReset()
    warn.mockReset()
    deferred.length = 0
    mockPrisma.user.findUnique.mockReset().mockResolvedValue({
      mcpSettings: JSON.stringify({ agentModes: { codex: 'off' } }),
    })
    vi.stubEnv('ASTRID_AGENT_EXECUTION_MODE_SHADOW', 'true')
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const input = {
    userId: 'private-user-id',
    mailbox: 'codex',
    mode: 'polling' as const,
  }

  it('records a sampled stored-Off mismatch without raw identifiers or settings', async () => {
    observeAgentExecutionMode(input)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    await deferred[0]()
    expect(info).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith(
      { userIdHash: expect.stringMatching(/^[a-f0-9]{64}$/), mailbox: 'codex' },
      'agent execution mode shadow mismatch',
    )
    expect(JSON.stringify(info.mock.calls)).not.toContain(input.userId)
    expect(JSON.stringify(info.mock.calls)).not.toContain('agentModes')
    expect(mockPrisma.user.findUnique).toHaveBeenCalledOnce()
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: input.userId },
      select: { mcpSettings: true },
    })
  })

  it.each(['polling', 'api', 'webhook'])('does not report a polling-only stored %s as a mismatch', async stored => {
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: JSON.stringify({ agentModes: { codex: stored } }) })
    observeAgentExecutionMode(input)
    await deferred[0]()
    expect(info).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'false', 'invalid'])('does no sampling, deferral or reads with disabled flag (%s)', flag => {
    vi.stubEnv('ASTRID_AGENT_EXECUTION_MODE_SHADOW', flag)
    observeAgentExecutionMode(input)
    expect(Math.random).not.toHaveBeenCalled()
    expect(deferred).toHaveLength(0)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('does no deferral or reads when sampled out at the exact 1% threshold', () => {
    vi.mocked(Math.random).mockReturnValue(0.01)
    observeAgentExecutionMode(input)
    expect(deferred).toHaveLength(0)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not parse unrelated mailbox settings', () => {
    observeAgentExecutionMode({ ...input, mailbox: 'claude' })
    expect(deferred).toHaveLength(0)
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('uses a stable hash instead of a raw user id across observations', async () => {
    observeAgentExecutionMode(input)
    observeAgentExecutionMode(input)
    await Promise.all(deferred.map(work => work()))
    expect(info.mock.calls[0][0]).toEqual(info.mock.calls[1][0])
  })

  it.each([undefined, null, '{}'])('does not invent stored Off for absent settings (%s)', async mcpSettings => {
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings })
    observeAgentExecutionMode(input)
    await deferred[0]()
    expect(info).not.toHaveBeenCalled()
  })

  it.each(['{invalid-json', '{"agentModes":42}'])('contains malformed settings without detailed parser diagnostics', async mcpSettings => {
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings })
    observeAgentExecutionMode(input)
    await expect(deferred[0]()).resolves.toBeUndefined()
    expect(info).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith({ mailbox: 'codex' }, 'agent execution mode shadow observation failed')
    expect(warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(warn.mock.calls)).not.toContain(mcpSettings)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(input.userId)
  })

  it('contains database failures without logging errors or raw ids', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error(`private failure: ${input.userId}`))
    observeAgentExecutionMode(input)
    await expect(deferred[0]()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith({ mailbox: 'codex' }, 'agent execution mode shadow observation failed')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(input.userId)
  })

  it('bounds a stalled settings observation at 250ms and ignores late results', async () => {
    vi.useFakeTimers()
    let finish!: (value: { mcpSettings: string }) => void
    mockPrisma.user.findUnique.mockReturnValue(new Promise(resolve => { finish = resolve }))
    observeAgentExecutionMode(input)
    const work = deferred[0]()
    await vi.advanceTimersByTimeAsync(249)
    expect(warn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(work).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    finish({ mcpSettings: JSON.stringify({ agentModes: { codex: 'off' } }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(info).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the observation timeout after a successful comparison', async () => {
    vi.useFakeTimers()
    observeAgentExecutionMode(input)
    await deferred[0]()
    expect(info).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(250)
    expect(warn).not.toHaveBeenCalled()
  })

  it('contains logger failures as well as observer failures', async () => {
    info.mockImplementation(() => { throw new Error('logger unavailable') })
    warn.mockImplementation(() => { throw new Error('logger unavailable') })
    expect(() => observeAgentExecutionMode(input)).not.toThrow()
    await expect(deferred[0]()).resolves.toBeUndefined()
  })
})
