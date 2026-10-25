import { describe, expect, it } from 'vitest'
import { runNativeCopilotBridge, type BridgeTransport } from '@/scripts/lib/native-copilot-bridge'
import { nativeCopilotClaimMarker, type NativeCopilotDispatch } from '@/lib/fixall-claim'

const listId = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba'
const marker = `<!-- astrid-native:v1:${listId}:task-1 -->`

function fixture() {
  const writes: Array<{ path: string; body: unknown }> = []
  const reports: string[] = []
  const task = { id: 'task-1', title: 'AWTD-1383 lifecycle', identifier: 'AWTD-1383', completed: false,
    description: 'Implement scoped native dispatch', assigneeId: 'copilot', statusRole: 'ready',
    updatedAt: '2026-10-20T00:00:00Z', lists: [{ id: listId }] }
  const comments = [{ id: 'human-1', content: 'Original request', updatedAt: '2026-10-20T00:00:00Z',
    authorId: 'human', author: { isAIAgent: false }, systemEventType: null }]
  const issueComments: Array<{ id: number; body: string; html_url: string; updated_at: string; user: { login: string } }> = []
  const prComments: typeof issueComments = []
  const state = { mode: 'polling', agentId: 'copilot', uncertainReceipt: false, failedSend: false,
    claimLost: false, uncertainClaim: false,
    pullReads: 0, changeHeadBeforeContinuation: false, uncertainReply: false, issue: null as null | {
    number: number; body: string; html_url: string; state: string; updated_at: string;
    user: { login: string }; assignees: Array<{ login: string }>
  }, hasPull: false, assignmentWorks: true, truncated: false, humanResume: false }
  const transport: BridgeTransport = {
    async astrid<T>(path: string, body?: unknown): Promise<T> {
      if (body !== undefined) {
        writes.push({ path, body })
        if (path.endsWith('/claim-fixall')) {
          if (state.claimLost) {
            task.statusRole = 'doing'
            throw new Error('claim conflict: another Copilot session won')
          }
          task.statusRole = (body as { action: string }).action === 'pause' ? 'waiting' : 'doing'
          task.assigneeId = 'copilot'
          const nativeDispatch = (body as { nativeDispatch?: NativeCopilotDispatch }).nativeDispatch
          if (nativeDispatch) comments.push({ ...comments[0], id: 'claim', authorId: 'copilot',
            author: { isAIAgent: true }, content: nativeCopilotClaimMarker(listId, task.id, nativeDispatch) })
          if (state.uncertainClaim) throw new Error('uncertain committed claim response')
        }
        if (path.endsWith('/comments')) comments.push({ ...comments[0], id: `agent-${comments.length}`,
          content: (body as { content: string }).content, authorId: 'copilot', author: { isAIAgent: true } })
        return {} as T
      }
      if (path.includes('/agent-queue')) return {
        mode: state.mode, agent: { id: state.agentId, mailbox: 'copilot' }, truncated: false,
        queue: task.statusRole === 'ready' ? [{ id: task.id }] : [],
        attention: { skipped: [], truncated: false, tasks: state.humanResume && task.assigneeId === 'human' ? [{
          id: task.id, resume: { listId, assigneeId: 'human', handbackCommentId: 'question',
            replyCommentId: 'human-1', commentWatermark: comments[0].updatedAt },
        }] : [] },
      } as T
      if (path.endsWith('/comments')) return { comments, meta: { truncated: state.truncated } } as T
      return { task } as T
    },
    async github<T>(path: string, body?: unknown): Promise<T> {
      let data: unknown
      if (path === '/user') data = { login: 'owner' }
      else if (path === '/graphql') data = { data: { repository: { suggestedActors: { nodes: [{ login: 'copilot-swe-agent' }] } } } }
      else if (body !== undefined) {
        writes.push({ path, body })
        if (path.endsWith('/assignees')) {
          if (state.failedSend) throw new Error('network failure before assignment')
          if (state.assignmentWorks) state.issue!.assignees = [{ login: 'copilot-swe-agent[bot]' }]
          if (state.uncertainReceipt) throw new Error('uncertain assignment response')
          data = state.issue
        } else if (path.endsWith('/comments')) {
          const rows = path.includes('/issues/2/') ? prComments : issueComments
          const row = { id: rows.length + 1, body: (body as { body: string }).body,
            html_url: 'https://github.com/comment', updated_at: 'now', user: { login: 'owner' } }
          rows.push(row)
          if (rows === prComments && state.uncertainReply) throw new Error('uncertain continuation response')
          data = row
        } else {
          state.issue = { number: 1, body: (body as { body: string }).body,
            html_url: 'https://github.com/Graceful-Tools/astrid-web/issues/1', state: 'open',
            updated_at: new Date().toISOString(), user: { login: 'owner' }, assignees: [] }
          data = state.issue
        }
      } else if (path.includes('/timeline')) data = state.hasPull ? [{
        event: 'cross-referenced', source: { issue: { number: 2, pull_request: {} } },
      }] : []
      else if (path.includes('/pulls/2')) data = { number: 2, body: marker, state: 'open',
        user: { login: 'Copilot' }, head: { sha: (++state.pullReads > 1 && state.changeHeadBeforeContinuation ? 'b' : 'a').repeat(40) },
        base: { repo: { full_name: 'Graceful-Tools/astrid-web' } }, html_url: 'https://github.com/Graceful-Tools/astrid-web/pull/2' }
      else if (path.includes('/comments')) data = path.includes('/issues/2/') ? prComments : issueComments
      else data = state.issue ? [state.issue] : []
      return data as T
    },
  }
  const run = (dryRun = false) => runNativeCopilotBridge({
    transport, repo: 'Graceful-Tools/astrid-web', listId, dryRun,
    issueTemplate: '## Problem\nSee Astrid.', report: message => reports.push(message),
  })
  return { state, task, comments, writes, issueComments, prComments, reports, run }
}

describe('native GitHub Copilot bridge (AWTD-1383)', () => {
  it('dry-runs without creating issues, claiming tasks, acknowledging replies or triggering an agent', async () => {
    const f = fixture()
    await f.run(true)
    expect(f.writes).toEqual([])
    expect(f.reports).toContain('WOULD SYNC AWTD-1383')
  })

  it('fails before all mutations in API mode, without identity, or with truncated history', async () => {
    const f = fixture()
    f.state.mode = 'api'
    await expect(f.run()).rejects.toThrow(/polling-only/)
    f.state.mode = 'polling'
    f.state.agentId = ''
    await expect(f.run()).rejects.toThrow(/identity/)
    f.state.agentId = 'copilot'
    f.state.truncated = true
    await expect(f.run()).rejects.toThrow(/truncated/)
    expect(f.writes).toEqual([])
  })

  it('creates an inert mirror, atomically claims the exact board, then uses documented native assignment', async () => {
    const f = fixture()
    await f.run()
    expect(f.writes[0].body).not.toHaveProperty('assignees')
    const claim = f.writes.find(row => row.path.endsWith('/claim-fixall'))!
    expect(claim.body).toEqual({ action: 'ready', agent: 'copilot', listId,
      nativeDispatch: { repository: 'Graceful-Tools/astrid-web', issueNumber: 1 } })
    const assignment = f.writes.find(row => row.path.endsWith('/assignees'))!
    expect(assignment.body).toMatchObject({
      assignees: ['copilot-swe-agent[bot]'], agent_assignment: { target_repo: 'Graceful-Tools/astrid-web', base_branch: 'main' },
    })
    expect(f.writes.indexOf(claim)).toBeLessThan(f.writes.indexOf(assignment))
    await f.run()
    expect(f.writes.filter(row => row.path.endsWith('/assignees'))).toHaveLength(1)
    expect(f.writes.filter(row => row.path.endsWith('/claim-fixall'))).toHaveLength(1)
  })

  it('never takes a human task without the scoped pending-handback resume context', async () => {
    const f = fixture()
    f.task.assigneeId = 'human'
    await f.run()
    expect(f.writes).toEqual([])
  })

  it('resumes a validated handback and forwards new replies to the linked PR exactly once', async () => {
    const f = fixture()
    await f.run()
    f.task.assigneeId = 'human'
    f.task.statusRole = 'waiting'
    f.state.humanResume = true
    f.state.hasPull = true
    f.comments.push({ ...f.comments[0], id: 'human-2', content: 'The answer is blue.' })
    await f.run()
    expect(f.writes.find(row => (row.body as { action?: string }).action === 'resume')?.body).toMatchObject({
      action: 'resume', listId, resume: { assigneeId: 'human' },
    })
    expect(f.prComments.filter(row => row.body.includes('The answer is blue.'))).toHaveLength(1)
    expect(f.prComments[0].body).toContain('@copilot')
    await f.run()
    expect(f.prComments.filter(row => row.body.includes('The answer is blue.'))).toHaveLength(1)
  })

  it('mirrors native agent comments to Astrid without echoing them as human prompts', async () => {
    const f = fixture()
    await f.run()
    f.issueComments.push({ id: 44, body: 'Need clarification', html_url: 'https://github.com/comment/44',
      updated_at: '2026-10-20T01:00:00Z', user: { login: 'copilot-swe-agent[bot]' } })
    await f.run()
    await f.run()
    expect(f.comments.filter(row => row.content.includes('Need clarification'))).toHaveLength(1)
    expect(f.comments.find(row => row.content.includes('Need clarification'))?.authorId).toBe('copilot')
  })

  it('persists dispatch attempts and stops after three instead of looping or falling back to CLI', async () => {
    const f = fixture()
    f.state.assignmentWorks = false
    for (let attempt = 0; attempt < 3; attempt++) await expect(f.run()).rejects.toThrow(/did not assign/)
    await expect(f.run()).rejects.toThrow(/exhausted three persisted attempts/)
    expect(f.writes.filter(row => row.path.endsWith('/assignees'))).toHaveLength(3)
    expect(f.issueComments).toHaveLength(3)
    expect(f.task.statusRole).toBe('waiting')
  })

  it('recovers the owned inert issue after failure between claim and native assignment', async () => {
    const f = fixture()
    f.state.failedSend = true
    await expect(f.run()).rejects.toThrow(/network failure/)
    expect(f.task.statusRole).toBe('doing')
    f.state.failedSend = false
    await f.run()
    expect(f.state.issue?.assignees).toEqual([{ login: 'copilot-swe-agent[bot]' }])
    expect(f.writes.filter(row => row.path.endsWith('/claim-fixall'))).toHaveLength(1)
    expect(f.writes.filter(row => row.path.endsWith('/issues'))).toHaveLength(1)
  })

  it('does not redispatch after an assignment succeeded but its response was lost', async () => {
    const f = fixture()
    f.state.uncertainReceipt = true
    await expect(f.run()).rejects.toThrow(/uncertain assignment/)
    await f.run()
    expect(f.writes.filter(row => row.path.endsWith('/assignees'))).toHaveLength(1)
  })

  it('fails closed on malformed mappings and a changed PR head without acknowledging a reply', async () => {
    const f = fixture()
    await f.run()
    const body = f.state.issue!.body
    f.state.issue!.body += '\ncorrupted footer'
    await expect(f.run()).rejects.toThrow(/Malformed native task mapping/)
    f.state.issue!.body = body
    f.state.hasPull = true
    f.state.changeHeadBeforeContinuation = true
    f.comments.push({ ...f.comments[0], id: 'new-reply', content: 'New answer' })
    await expect(f.run()).rejects.toThrow(/changed before continuation/)
    expect(f.prComments).toEqual([])
  })

  it('deduplicates continuation after GitHub accepted the exact PR/head/task comment but its response was lost', async () => {
    const f = fixture()
    await f.run()
    f.state.hasPull = true
    f.state.uncertainReply = true
    f.comments.push({ ...f.comments[0], id: 'new-reply', content: 'New answer' })
    await expect(f.run()).rejects.toThrow(/uncertain continuation/)
    await f.run()
    expect(f.prComments).toHaveLength(1)
    expect(f.prComments[0].body).toContain(`astrid-continuation:task-1:2:${'a'.repeat(40)}`)
  })

  it('parks stale native execution with an Astrid notice instead of stranding Doing or starting a second agent', async () => {
    const f = fixture()
    await f.run()
    f.state.issue!.updated_at = '2020-01-01T00:00:00Z'
    await f.run()
    await f.run()
    expect(f.task.statusRole).toBe('waiting')
    expect(f.comments.filter(row => row.content.includes('native-copilot-stalled:'))).toHaveLength(1)
    expect(f.writes.filter(row => row.path.endsWith('/assignees'))).toHaveLength(1)
  })

  it('AWTD-1383: never adopts another Copilot session after losing the claim on an inert mirror', async () => {
    const f = fixture()
    f.state.claimLost = true
    await expect(f.run()).rejects.toThrow(/claim conflict/)
    f.state.claimLost = false
    await f.run()
    expect(f.writes.filter(row => row.path.endsWith('/assignees'))).toHaveLength(0)
  })

  it('recovers its own committed claim after a lost response without taking a second claim', async () => {
    const f = fixture()
    f.state.uncertainClaim = true
    await expect(f.run()).rejects.toThrow(/uncertain committed claim/)
    f.state.uncertainClaim = false
    await f.run()
    expect(f.writes.filter(row => row.path.endsWith('/claim-fixall'))).toHaveLength(1)
    expect(f.writes.filter(row => row.path.endsWith('/assignees'))).toHaveLength(1)
  })
})
