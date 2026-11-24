/**
 * ADEV-248 (web side of iOS ADEV-232 and ADEV-231): you can choose on your own decision, and a grid
 * you choose from has a wider option column.
 *
 * Someone weighing their own trade-off chooses too: a decision in your own comment takes a tap and
 * a confirmation like anyone else's, and the asker's own reply counts as the answer when it picks an
 * option (`2 — Cabin`). The asker's follow-up in words doesn't. iOS: `DecisionThread.answer`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decisionAnswer } from '@/lib/decision-thread'
import { parseDecision } from '@/lib/comment-formats'

const QUESTION = '**Decision:** Where?\n\n- **1.** Lisbon (recommended)\n- **2.** Cabin'
const options = parseDecision(QUESTION)!.options

const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 12, minute)).toISOString()
const asked = { id: 'q', authorId: 'jon', content: QUESTION, createdAt: at(0) }
const reply = (id: string, authorId: string | null, content: string, minute: number) =>
  ({ id, authorId, content, createdAt: at(minute) })

describe('ADEV-248 the answer to a decision', () => {
  it('is null while nobody has replied', () => {
    expect(decisionAnswer(asked, [asked], options)).toBeNull()
  })

  it("counts the asker's own reply when it picks an option", () => {
    const own = reply('r1', 'jon', '2 — Cabin', 1)
    expect(decisionAnswer(asked, [asked, own], options)?.id).toBe('r1')
  })

  it("skips the asker's follow-up in words", () => {
    const words = reply('r1', 'jon', 'Also thinking about Porto', 1)
    expect(decisionAnswer(asked, [asked, words], options)).toBeNull()
    const pick = reply('r2', 'jon', '1', 2)
    expect(decisionAnswer(asked, [asked, words, pick], options)?.id).toBe('r2')
  })

  it("counts anyone else's first reply, in words or not", () => {
    const other = reply('r1', 'ana', 'Not sure yet', 1)
    expect(decisionAnswer(asked, [asked, other], options)?.id).toBe('r1')
  })

  it('ignores system lines and replies from before the question', () => {
    const system = reply('s', null, 'Jon Paris moved this task', 1)
    const earlier = reply('e', 'ana', '1', -1)
    expect(decisionAnswer(asked, [earlier, asked, system], options)).toBeNull()
  })

  it('takes the earliest answer whatever order the comments arrive in', () => {
    const late = reply('r2', 'ana', '1 — Lisbon', 5)
    const early = reply('r1', 'jon', '2 — Cabin', 2)
    expect(decisionAnswer(asked, [late, asked, early], options)?.id).toBe('r1')
  })
})

describe('ADEV-248 your own decision is choosable in the thread', () => {
  const section = readFileSync(join(process.cwd(), 'components/task-detail/CommentSection.tsx'), 'utf8')

  it('reads the answer through decisionAnswer', () => {
    expect(section).toContain('decisionAnswer(')
  })

  it('does not withhold the choice from the asker', () => {
    const line = section.split('\n').find(l => l.includes('const canAnswer')) ?? ''
    expect(line).not.toBe('')
    expect(line).not.toContain('isCurrentUser')
  })
})

describe('ADEV-248 a grid you choose from has a wider option column (iOS ADEV-231)', () => {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
  const cards = readFileSync(join(process.cwd(), 'components/task-detail/DecisionCards.tsx'), 'utf8')

  function rule(selector: string): string {
    const start = css.indexOf(`\n${selector} {`)
    if (start === -1) throw new Error(`no rule for ${selector}`)
    return css.slice(css.indexOf('{', start + 1) + 1, css.indexOf('}', start + 1))
  }

  it('a choosable grid gives its option column 150–280px, up to half the width', () => {
    const wide = rule('.decision-grid-choice[data-choosable] .tradeoff-scroll table.tradeoff-grid')
    expect(wide).toContain('--tradeoff-option-min: 150px')
    expect(wide).toContain('--tradeoff-option-max: min(280px, 50vw)')
  })

  it('a read-only grid keeps 96–192px, up to a third', () => {
    const grid = rule('.tradeoff-scroll table.tradeoff-grid')
    expect(grid).toContain('--tradeoff-option-min: 6rem')
    expect(grid).toContain('--tradeoff-option-max: min(12rem, 33vw)')
  })

  it('marks the grid choosable only while it can be chosen', () => {
    expect(cards).toContain('data-choosable={onChoose ? true : undefined}')
  })
})
