/**
 * AWTD-1531: one canonical Decision example, quoted verbatim by the guide and taught by the MCP
 * tool descriptions, so the docs cannot drift from what the recognisers read.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DECISION_EXAMPLE } from '@/lib/decision-examples'
import { parseDecision, isTradeoffGrid } from '@/lib/comment-formats'
import { OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('Decision guide (AWTD-1531)', () => {
  it('the canonical example is a Decision with one recommended option and a grid', () => {
    const d = parseDecision(DECISION_EXAMPLE)!
    expect(d.options.map(o => o.number)).toEqual([1, 2, 3])
    expect(d.options.filter(o => o.recommended)).toHaveLength(1)
    const rows = d.after
      .split('\n')
      .filter(l => l.startsWith('|'))
      .slice(2)
      .map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
    expect(isTradeoffGrid(rows)).toBe(true)
  })

  it('docs/DECISIONS.md quotes the canonical example verbatim', () => {
    expect(read('docs/DECISIONS.md')).toContain(DECISION_EXAMPLE)
  })

  it('the contract and the fixall workflow point at the guide', () => {
    expect(read('docs/PRODUCT_CONTRACT.md')).toContain('DECISIONS.md')
    expect(read('docs/FIXALL_WORKFLOW.md')).toContain('DECISIONS.md')
  })

  it('add_comment teaches both formats to agents', () => {
    const tool = OAUTH_MCP_TOOLS.find(t => t.name === 'add_comment')!
    expect(tool.description).toContain('**Decision:**')
    expect(tool.description).toContain('(recommended)')
    expect(tool.description).toMatch(/\+\+ very good/)
    expect(tool.description).toContain('AGENT-HANDBACK')
  })
})
