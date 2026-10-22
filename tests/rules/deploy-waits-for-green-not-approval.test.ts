/**
 * AWTD-1322: no agent-facing document may tell an agent to wait for a human's
 * "ship it" before deploying, or for approval before marking a task complete.
 *
 * Since 2026-10-13 the rule is the opposite (CLAUDE.md rule 3,
 * docs/CLI_OPERATIONS.md §0–§1): deploy once `npm run predeploy` is green on
 * the merged main — a pending migration and a red gate are the two exceptions
 * — and a task is done when production serves it. ASTRID.md, read by every
 * agent, still said "Ask user: Ready to ship it? / Wait for approval before
 * deploying", and docs/CLI_OPERATIONS.md contradicted its own §0 forty lines
 * further down. An agent following those finishes green work and leaves it
 * undeployed — the outcome the rule exists to prevent.
 *
 * Blockquotes are skipped: they are where these documents quote an old rule
 * back to explain it (the same convention as pushing-main-does-not-deploy).
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
    'docs/CLI_OPERATIONS.md',
  ].filter(path => existsSync(join(ROOT, path)))
  const commands = join(ROOT, '.claude/commands')
  const slash = existsSync(commands)
    ? readdirSync(commands).filter(n => n.endsWith('.md')).map(n => `.claude/commands/${n}`)
    : []
  return [...named, ...slash]
}

/** An instruction to wait for a human before deploying or completing. */
const WAITS_FOR_APPROVAL = [
  /\bwait for (?:user |Jon'?s? )?approval before (?:deploying|shipping|marking|final completion|merging)/i,
  /\bask (?:the )?user\b[^.]{0,40}ready to ship/i,
  /\bdeploy to production \((?:only )?after (?:user approval|the user says)/i,
  /\bonly after the user says ["“']?ship it/i,
  /\bask the user if they(?:'| a)re ready to ship/i,
]

function offendingLines(source: string): string[] {
  return source
    .split(/\n\s*\n/)
    .filter(p => !p.trim().split('\n').every(line => line.trim().startsWith('>')))
    .flatMap(p => p.split('\n'))
    .filter(line => WAITS_FOR_APPROVAL.some(rule => rule.test(line)))
    .map(line => line.trim())
}

describe('deploying waits for green gates, not for approval (AWTD-1322)', () => {
  it('no agent-facing document tells an agent to wait for a ship-it', () => {
    const offenders = agentFacingDocs().flatMap(doc =>
      offendingLines(readFileSync(join(ROOT, doc), 'utf8')).map(line => `${doc}: ${line.slice(0, 140)}`),
    )
    expect(
      offenders,
      'Since 2026-10-13 an agent deploys once predeploy is green on merged main ' +
        '(pending migration or red gate excepted) and completes a task when production ' +
        'serves it. See docs/CLI_OPERATIONS.md §0–§1.',
    ).toEqual([])
  })

  it('recognises the instruction, so it cannot pass by matching nothing', () => {
    expect(offendingLines('- Wait for approval before deploying')).toHaveLength(1)
    expect(offendingLines('- Ask user: "Ready to ship it?"')).toHaveLength(1)
    expect(offendingLines('# Deploy to production (after user approval)')).toHaveLength(1)
    expect(offendingLines('> - Wait for approval before deploying')).toEqual([])
  })
})
