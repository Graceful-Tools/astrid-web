import { describe, expect, it } from 'vitest'
import { findBoardList } from '@/scripts/lib/board-by-name'
import { resolveReadyQueueOptions } from '@/lib/ready-queue-scope'
import { readSeenKeysInput } from '@/scripts/lib/seen-keys-input'
import { parseClaimArgs } from '@/scripts/lib/fixall-claim-args'

describe('Astrid lifecycle launcher inputs', () => {
  it('refuses ambiguous board names rather than silently selecting another board', () => {
    expect(() => findBoardList([{ id: '1', name: 'Astrid Android To-do' },
      { id: '2', name: 'Astrid Android To-do' }], 'android')).toThrow(/Multiple/)
  })
  it('preserves an explicit board id for the lane sweep', () => {
    expect(resolveReadyQueueOptions(['android', '--list', 'board-2', '--harness', 'codex'], {}))
      .toMatchObject({ board: 'android', listId: 'board-2', harness: 'codex' })
  })
  it('strictly validates acknowledgement keys', () => {
    expect(readSeenKeysInput('["comment:a:b"]')).toEqual(['comment:a:b'])
    expect(() => readSeenKeysInput('["a",42]')).toThrow()
    expect(() => readSeenKeysInput('[]', 'file')).toThrow(/not both/)
    expect(() => readSeenKeysInput()).toThrow()
  })
  it('AWTD-1383: reads Windows-safe UTF-8 resume JSON and refuses mixed or broken inputs', () => {
    const context = { listId: 'board', assigneeId: 'human', handbackCommentId: 'question',
      replyCommentId: 'reply', commentWatermark: '2026-10-20T00:00:00Z' }
    const args = ['task', 'resume', context.commentWatermark, '--agent', 'copilot',
      '--list', 'board', '--resume-context-file', 'resume.json']
    expect(parseClaimArgs(args, () => '\uFEFF' + JSON.stringify(context))).toMatchObject({ resume: context, listId: 'board' })
    expect(() => parseClaimArgs([...args, '--resume-context', JSON.stringify(context)])).toThrow(/not both/)
    expect(() => parseClaimArgs(args, () => 'not-json')).toThrow()
    expect(() => parseClaimArgs(args, () => '[]')).toThrow()
    expect(() => parseClaimArgs(args, () => { throw new Error('unreadable') })).toThrow(/unreadable/)
  })
})
