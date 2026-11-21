/**
 * ADEV-178: traffic lights follow the Extreme Clarity method (jon.paris/extremeclarity, Appendix 5).
 *
 * The recommendation comes first and names its option number, a do-nothing option is always
 * assessed, nothing scores or counts the colours, and the two bright ratings mean something:
 * `++` Decisive (this alone is a reason to choose) and `--` Disqualifying (this alone rules the
 * option out). Both are a high bar. The example, the guide, the help page and the MCP hint teach it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DECISION_EXAMPLE } from '@/lib/decision-examples'
import { parseDecision, RATING_STYLE } from '@/lib/comment-formats'
import { OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'
import en from '@/lib/i18n/locales/en.json'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('Extreme Clarity traffic lights (ADEV-178)', () => {
  it('the bright ratings are Decisive and Disqualifying, in the fallback and the locale', () => {
    expect(RATING_STYLE['++'].label).toBe('Decisive')
    expect(RATING_STYLE['--'].label).toBe('Disqualifying')
    expect(en.tasks.tradeoffRatings.veryGood).toBe('Decisive')
    expect(en.tasks.tradeoffRatings.veryPoor).toBe('Disqualifying')
  })

  it('the canonical example leads with the recommendation, by option number', () => {
    const lead = DECISION_EXAMPLE.split('\n\n')[0]
    const d = parseDecision(DECISION_EXAMPLE)!
    const recommended = d.options.find(o => o.recommended)!
    expect(lead).toMatch(/^We recommend /)
    expect(lead).toContain(`(#${recommended.number})`)
    expect(lead).toMatch(/accepting /)
  })

  it('the canonical example assesses doing nothing, in the cards and the grid', () => {
    const d = parseDecision(DECISION_EXAMPLE)!
    expect(d.options.some(o => /^Do nothing/.test(o.text))).toBe(true)
    expect(d.after).toMatch(/^\| \d+\. Do nothing \|/m)
  })

  it('the canonical example has no score or total column, and uses each bright rating at most once', () => {
    const header = DECISION_EXAMPLE.split('\n').find(l => l.startsWith('| Option'))!
    expect(header).not.toMatch(/score|total|weight/i)
    expect(DECISION_EXAMPLE.match(/\| \+\+ /g)?.length ?? 0).toBeLessThanOrEqual(1)
    expect(DECISION_EXAMPLE.match(/\| -- /g)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it('agents are taught the method in the add_comment hint', () => {
    const hint = OAUTH_MCP_TOOLS.find(t => t.name === 'add_comment')!.description
    expect(hint).toMatch(/do nothing/i)
    expect(hint).toMatch(/recommendation first/i)
    expect(hint).toMatch(/\+\+ decisive/i)
    expect(hint).toMatch(/-- disqualifying/i)
    expect(hint).toMatch(/high bar/i)
    expect(hint).toMatch(/never (add )?a score/i)
  })

  it('the guide states the method', () => {
    const guide = read('docs/DECISIONS.md')
    expect(guide).toContain('jon.paris/extremeclarity')
    expect(guide).toMatch(/Do nothing/)
    expect(guide).toMatch(/\| `\+\+` \| Decisive\b/)
    expect(guide).toMatch(/\| `--` \| Disqualifying\b/)
    expect(guide).toMatch(/never .*score/i)
  })
})
