/**
 * Ready by default; only high risk waits for Jon (2026-11-15).
 *
 * Jon: "Unless tasks are high risk (eg breaking data base changes, dropping columns) when you
 * find issues add them directly to ready. I only want to review changes that are high risk."
 *
 * Before this, agent-facing docs told loops to file new work into the Inbox "so no loop starts
 * it before Jon promotes it" and to hand back every product decision. On the Windows board that
 * left a third of the open tasks waiting on a person who had asked not to be asked. This pins
 * the policy where every harness reads it, and stops the old instruction coming back.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

function agentFacingDocs(): string[] {
  const named = [
    'CLAUDE.md',
    'AGENTS.md',
    'CODEX.md',
    'GEMINI.md',
    'ASTRID.md',
    'docs/FIXALL_WORKFLOW.md',
    'docs/FIXALL_WEB.md',
    'docs/CLI_OPERATIONS.md',
  ].filter(path => existsSync(join(ROOT, path)))
  const commands = join(ROOT, '.claude/commands')
  const slash = existsSync(commands)
    ? readdirSync(commands).filter(n => n.endsWith('.md')).map(n => `.claude/commands/${n}`)
    : []
  return [...named, ...slash]
}

/** An instruction to park new work until a person promotes it. */
const PARKS_FOR_PROMOTION = [
  /\bfile[sd]? (?:it |them )?(?:in|into|to) (?:the )?Inbox,? not Ready\b/i,
  /\bso no loop starts (?:it|one) before Jon promotes it\b/i,
  /\bneeds a product decision, hand it back\b/i,
]

function offendingLines(source: string): string[] {
  return source
    .split('\n')
    .filter(line => !line.trim().startsWith('>'))
    .filter(line => PARKS_FOR_PROMOTION.some(rule => rule.test(line)))
    .map(line => line.trim())
}

describe('new work is filed Ready, and only high risk waits for Jon (2026-11-15)', () => {
  it('the shared workflow states the policy every harness reads', () => {
    const workflow = readFileSync(join(ROOT, 'docs/FIXALL_WORKFLOW.md'), 'utf8')
    expect(workflow).toMatch(/## Autonomy: file to Ready, ask only about high risk/)
    expect(workflow).toMatch(/Additive migrations are not high risk/)
  })

  it('no agent-facing document tells an agent to park work for promotion', () => {
    const offenders = agentFacingDocs().flatMap(doc =>
      offendingLines(readFileSync(join(ROOT, doc), 'utf8')).map(line => `${doc}: ${line.slice(0, 140)}`),
    )
    expect(
      offenders,
      'File issues you find straight to Ready; hand back only high-risk work. ' +
        'See docs/FIXALL_WORKFLOW.md → Autonomy.',
    ).toEqual([])
  })

  it('recognises the instruction, so it cannot pass by matching nothing', () => {
    expect(offendingLines('Filed in Inbox, not Ready, so no loop starts it before Jon promotes it.')).toHaveLength(1)
    expect(offendingLines('If a task needs a product decision, hand it back and move on.')).toHaveLength(1)
    expect(offendingLines('> filed in Inbox, not Ready (quoted history)')).toEqual([])
  })
})
