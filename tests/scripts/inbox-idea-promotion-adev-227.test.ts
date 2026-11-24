/**
 * ADEV-227: on the answer to an Inbox idea's Decision, the run writes the chosen
 * scope under a `**Decided:**` line, keeps the original note, and moves the task
 * to Ready, unassigned, so the next run builds it.
 *
 * The reply arrives through the existing resume path
 * (`attention.tasks[].resume` → `claim-fixall-task.ts resume`), which moves the
 * task Inbox → Doing assigned to the agent. `scripts/promote-inbox-idea.ts` is
 * the step after that claim.
 */
import { describe, expect, it } from 'vitest'
import {
  decidedFromReply,
  parsePromoteIdeaArgs,
  planIdeaPromotion,
} from '@/scripts/lib/inbox-idea-promotion'

const AGENT = { isAIAgent: true }
const JON = { isAIAgent: false }

const decision = {
  id: 'q', authorId: 'agent', author: AGENT, createdAt: '2026-11-23T11:00:00.000Z',
  content: [
    '**Decision:** which reading of this idea should we build?',
    '- **1.** Dark mode for the widget only (recommended)',
    '- **2.** Dark mode across the whole app',
    '- **3.** Do nothing',
    '',
    'AGENT-HANDBACK: claude',
  ].join('\n'),
}
const reply = (content: string) => ({
  id: 'r', authorId: 'jon', author: JON, createdAt: '2026-11-23T12:00:00.000Z', content,
})
const resumedTask = {
  description: 'dark mode for the widget?',
  statusRole: 'doing', // the resume claim moved it Inbox → Doing
  completed: false,
}

describe('the resume path promotes an Inbox idea to Ready on an option reply (ADEV-227)', () => {
  it('writes **Decided:** with the chosen option, keeps the note, and moves it to Ready unassigned', () => {
    const plan = planIdeaPromotion({
      task: resumedTask,
      comments: [reply('1 — Dark mode for the widget only'), decision],
      scope: 'Add a dark palette to the widget. Acceptance: follows the system setting.',
    })
    expect(plan.body.statusRole).toBe('ready')
    expect(plan.body.assigneeId).toBeNull()
    expect(plan.decided).toBe('option 1 — Dark mode for the widget only')
    expect(plan.body.description.startsWith('**Decided:** option 1 — Dark mode for the widget only')).toBe(true)
    expect(plan.body.description).toContain('Add a dark palette to the widget.')
    // The original note is kept, below the scope.
    expect(plan.body.description).toContain('dark mode for the widget?')
    expect(plan.body.description.indexOf('Add a dark palette')).toBeLessThan(
      plan.body.description.indexOf('dark mode for the widget?'),
    )
  })

  it('a bare number takes the option text from the Decision', () => {
    const plan = planIdeaPromotion({ task: resumedTask, comments: [reply('2'), decision], scope: 'All screens.' })
    expect(plan.decided).toBe('option 2 — Dark mode across the whole app')
  })

  it('a reply in words is not guessed at: it needs --decided', () => {
    expect(() =>
      planIdeaPromotion({ task: resumedTask, comments: [reply('Hmm, maybe both?'), decision], scope: 'x' }),
    ).toThrow(/--decided/)
  })

  it('--decided carries a reply in words, or a clear note promoted without a question', () => {
    const plan = planIdeaPromotion({
      task: { ...resumedTask, statusRole: null },
      comments: [],
      decided: 'clear as written (agent, 2026-11-24)',
      scope: 'Rename the button.',
    })
    expect(plan.body.description.startsWith('**Decided:** clear as written (agent, 2026-11-24)')).toBe(true)
    expect(plan.body.statusRole).toBe('ready')
  })

  it('refuses a completed task and a task in Waiting', () => {
    expect(() => planIdeaPromotion({ task: { ...resumedTask, completed: true }, comments: [], decided: 'x', scope: 'y' }))
      .toThrow(/completed/)
    expect(() => planIdeaPromotion({ task: { ...resumedTask, statusRole: 'waiting' }, comments: [], decided: 'x', scope: 'y' }))
      .toThrow(/Inbox or Doing/)
  })

  it('needs a scope', () => {
    expect(() => planIdeaPromotion({ task: resumedTask, comments: [], decided: 'x', scope: '  ' })).toThrow(/scope/)
  })
})

describe('decidedFromReply', () => {
  it('reads the tap form, a dash or dot form, a bare number and the old letter form', () => {
    expect(decidedFromReply('1 — Ship today')).toBe('option 1 — Ship today')
    expect(decidedFromReply('2 - Wait', decision.content)).toBe('option 2 — Wait')
    expect(decidedFromReply('3.', decision.content)).toBe('option 3 — Do nothing')
    expect(decidedFromReply('B', decision.content)).toBe('option 2 — Dark mode across the whole app')
  })

  it('is null for words', () => {
    expect(decidedFromReply('Let us talk about it')).toBeNull()
    expect(decidedFromReply('')).toBeNull()
  })
})

describe('parsePromoteIdeaArgs', () => {
  it('takes a task id, a scope, and optional --decided / --agent', () => {
    expect(parsePromoteIdeaArgs(['ADEV-1', '--scope', 'Do it', '--decided', 'option 1', '--agent', 'claude']))
      .toEqual({ taskId: 'ADEV-1', scope: 'Do it', scopeFile: undefined, decided: 'option 1' })
  })

  it('needs a scope or a scope file, and a task id', () => {
    expect(() => parsePromoteIdeaArgs(['ADEV-1'])).toThrow(/--scope/)
    expect(() => parsePromoteIdeaArgs(['--scope', 'x'])).toThrow(/Usage/)
  })
})
