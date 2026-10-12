/**
 * AWTD-1222: `remote` and `syncState` on a v1 task (spec §11.2), so a client
 * can draw a `repo#N` chip and a pending-sync mark. Absent on a classic task:
 * the task payload is near its budget and absent already means classic.
 */
import { describe, it, expect } from 'vitest'
import { taskRemoteFields, withTaskRemote } from '@/lib/backends/task-remote'

const issue = {
  remoteNodeId: 'I_abc',
  remoteKind: 'issue',
  remoteVersion: '2026-10-11T00:00:00Z',
  identifier: 'acme/web#42',
  syncState: null,
}

describe('taskRemoteFields (AWTD-1222)', () => {
  it.each([{}, { remoteNodeId: null, syncState: null, identifier: 'AWTD-1222' }])('a classic task (%o) adds nothing', task => {
    expect(taskRemoteFields(task)).toEqual({})
  })

  it('an issue links to its repo and number', () => {
    expect(taskRemoteFields(issue)).toEqual({
      remote: {
        kind: 'issue',
        url: 'https://github.com/acme/web/issues/42',
        nodeId: 'I_abc',
        version: '2026-10-11T00:00:00Z',
        repo: 'acme/web',
        number: 42,
      },
      syncState: 'synced',
    })
  })

  it('a pull request links to /pull', () => {
    const fields = taskRemoteFields({ ...issue, remoteNodeId: 'PR_abc', remoteKind: 'pull_request' })
    expect(fields.remote?.url).toBe('https://github.com/acme/web/pull/42')
  })

  it('a draft has no repo, number or url', () => {
    const fields = taskRemoteFields({ ...issue, remoteNodeId: 'DI_abc', remoteKind: 'draft', identifier: null })
    expect(fields.remote).toMatchObject({ kind: 'draft', url: null, repo: null, number: null, nodeId: 'DI_abc' })
  })

  it('an identifier that is not repo#N is not turned into a link', () => {
    expect(taskRemoteFields({ ...issue, identifier: 'AWTD-12' }).remote).toMatchObject({ url: null, repo: null, number: null })
  })

  it('a half-finished write-through is pending', () => {
    expect(taskRemoteFields({ ...issue, syncState: 'pending' }).syncState).toBe('pending')
  })
})

describe('withTaskRemote (AWTD-1222)', () => {
  it('replaces the raw remote columns on a GitHub task', () => {
    const shaped = withTaskRemote({ id: 't1', ...issue })
    expect(shaped).not.toHaveProperty('remoteNodeId')
    expect(shaped).not.toHaveProperty('remoteKind')
    expect(shaped).not.toHaveProperty('remoteVersion')
    expect(shaped).toMatchObject({ id: 't1', identifier: 'acme/web#42', syncState: 'synced', remote: { number: 42 } })
  })

  it('a classic task carries none of it', () => {
    const shaped = withTaskRemote({ id: 't1', title: 'x', remoteNodeId: null, remoteKind: null, remoteVersion: null, syncState: null })
    expect(shaped).toEqual({ id: 't1', title: 'x' })
  })
})
