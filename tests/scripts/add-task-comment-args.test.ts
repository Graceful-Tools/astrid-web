/**
 * ADEV-34: `add-task-comment.ts <id> --agent claude "text"` posted the literal
 * comment "--agent" and dropped the text (2026-11-16, four tasks). The flag is
 * accepted anywhere now, and content that is empty or looks like a flag is refused.
 */
import { describe, expect, it } from 'vitest'
import { parseCommentArgs } from '../../scripts/lib/comment-args'

describe('parseCommentArgs (ADEV-34)', () => {
  it('takes --agent before the text', () => {
    expect(parseCommentArgs(['t1', '--agent', 'codex', 'Fixed it'])).toEqual({ taskId: 't1', content: 'Fixed it', mailbox: 'codex' })
  })
  it('takes --agent after the text, and --agent=x', () => {
    expect(parseCommentArgs(['t1', 'Fixed it', '--agent', 'claude'])).toEqual({ taskId: 't1', content: 'Fixed it', mailbox: 'claude' })
    expect(parseCommentArgs(['t1', '--agent=codex', 'Fixed it']).mailbox).toBe('codex')
  })
  it('defaults the mailbox to claude', () => {
    expect(parseCommentArgs(['t1', 'Fixed it'])).toEqual({ taskId: 't1', content: 'Fixed it', mailbox: 'claude' })
  })
  it('refuses a missing text, a flag-looking text and an unknown flag', () => {
    expect(() => parseCommentArgs(['t1'])).toThrow(/Usage/)
    expect(() => parseCommentArgs(['t1', '--agent', 'claude'])).toThrow(/Usage/)
    expect(() => parseCommentArgs(['t1', '--agent'])).toThrow()
    expect(() => parseCommentArgs(['t1', '--bogus', 'x'])).toThrow(/Unknown flag --bogus/)
  })
  it('refuses more than one text argument instead of guessing', () => {
    expect(() => parseCommentArgs(['t1', 'one', 'two'])).toThrow(/one comment/)
  })
})
