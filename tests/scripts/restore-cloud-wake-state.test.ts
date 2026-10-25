import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exec, write, mkdir } = vi.hoisted(() => ({ exec: vi.fn(), write: vi.fn(), mkdir: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: exec, default: { execFileSync: exec } }))
vi.mock('node:fs', () => ({ writeFileSync: write, mkdirSync: mkdir,
  default: { writeFileSync: write, mkdirSync: mkdir } }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('ASTRID_FIXALL_HARNESS', 'github-copilot')
  vi.stubEnv('GITHUB_REF_NAME', 'main')
  vi.stubEnv('GITHUB_RUN_ID', '99')
  vi.stubEnv('RUNNER_TEMP', '/tmp/test-astrid-state')
})

describe('cloud wake state restoration', () => {
  it('restores only matching harness and branch state, including failed-run attempts', async () => {
    exec.mockReturnValueOnce(JSON.stringify([{ artifacts: [
      { id: 1, name: 'agent-run-codex-1', expired: false, workflow_run: { head_branch: 'main' } },
      { id: 2, name: 'agent-run-github-copilot-2', expired: false, workflow_run: { head_branch: 'other' } },
      { id: 3, name: 'agent-run-github-copilot-3', expired: false, workflow_run: { head_branch: 'main' } },
    ] }])).mockReturnValueOnce(Buffer.from('zip'))
      .mockReturnValueOnce('.agent-state/seen.json\n.agent-state/seen.json.attempts.json\n')
      .mockReturnValueOnce('["comment:t:c"]')
      .mockReturnValueOnce('{"comment:x:y":1}')
    await import('@/scripts/restore-cloud-wake-state')
    expect(exec.mock.calls[1][1]).toContain('repos/{owner}/{repo}/actions/artifacts/3/zip')
    expect(write).toHaveBeenCalledWith('.agent-state/seen.json', '["comment:t:c"]')
    expect(write).toHaveBeenCalledWith('.agent-state/seen.json.attempts.json', '{"comment:x:y":1}')
  })
  it('refuses malformed retained attempts instead of resetting retry limits', async () => {
    exec.mockReturnValueOnce(JSON.stringify([{ artifacts: [
      { id: 3, name: 'agent-run-github-copilot-3', expired: false, workflow_run: { head_branch: 'main' } },
    ] }])).mockReturnValueOnce(Buffer.from('zip'))
      .mockReturnValueOnce('.agent-state/seen.json\n.agent-state/seen.json.attempts.json\n')
      .mockReturnValueOnce('[]').mockReturnValueOnce('{"comment:x:y":"one"}')
    await expect(import('@/scripts/restore-cloud-wake-state')).rejects.toThrow(/malformed/)
    expect(write).not.toHaveBeenCalledWith('.agent-state/seen.json', expect.anything())
  })
  it('initializes explicit first-run state when no retained outcome exists', async () => {
    exec.mockReturnValueOnce(JSON.stringify([{ artifacts: [] }]))
    await import('@/scripts/restore-cloud-wake-state')
    expect(write).toHaveBeenCalledWith('.agent-state/seen.json', '[]')
    expect(write).toHaveBeenCalledWith('.agent-state/seen.json.attempts.json', '{}')
  })
})
