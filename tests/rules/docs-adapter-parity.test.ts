/**
 * Harness-adapter parity (AWTD-763).
 *
 * CLAUDE.md, AGENTS.md, CODEX.md, GEMINI.md, and .github/copilot-instructions.md
 * are thin adapters over the canonical policy in ASTRID.md and
 * docs/CLI_OPERATIONS.md. They have drifted before — one was "a broken
 * mechanical copy" that invented paths — so every mutable rule they restate is
 * pinned here to the canonical wording markers, and retired surfaces stay
 * retired. When this test fails, fix the CANONICAL document first, then make
 * the adapter agree with it; never the reverse.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const ADAPTERS = [
  'CLAUDE.md',
  'AGENTS.md',
  'CODEX.md',
  'GEMINI.md',
  '.github/copilot-instructions.md',
]

/** Live documentation that must not link retired surfaces. Archives are exempt. */
const LIVE_DOCS = [...ADAPTERS, 'ASTRID.md', 'README.md', 'docs/README.md']

describe('harness adapters stay thin and point at canonical policy (AWTD-763)', () => {
  it('canonical owners exist', () => {
    for (const owner of ['ASTRID.md', 'docs/CLI_OPERATIONS.md', 'docs/FIXALL_WORKFLOW.md']) {
      expect(fs.existsSync(path.join(root, owner)), `${owner} missing`).toBe(true)
    }
  })

  it('every adapter points at ASTRID.md, and operational adapters at CLI_OPERATIONS.md', () => {
    for (const adapter of ADAPTERS) {
      expect(read(adapter), `${adapter} must point at ASTRID.md`).toContain('ASTRID.md')
    }
    for (const adapter of ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']) {
      expect(read(adapter), `${adapter} must point at CLI_OPERATIONS.md`).toContain(
        'CLI_OPERATIONS.md',
      )
    }
  })

  it('restated mutable rules agree with the canonical wording markers', () => {
    for (const adapter of ADAPTERS) {
      const content = read(adapter)

      // Deploy rule: anyone restating it must state the workflow_dispatch-only
      // trigger and must not resurrect push-to-main-deploys.
      if (/deploys are MANUAL/i.test(content)) {
        expect(content, `${adapter} restates the deploy rule without the trigger fact`).toContain(
          'workflow_dispatch',
        )
        expect(content, `${adapter} must say pushing does NOT ship`).toMatch(
          /pushing to `?main`? does NOT ship/i,
        )
      }

      // Env-file rule: the vercel pull ban always covers all three commands.
      if (content.includes('vercel pull')) {
        expect(content, `${adapter} bans vercel pull but not env pull`).toContain('vercel env pull')
        expect(content, `${adapter} must state the ban as NEVER`).toContain('NEVER')
      }

      // API contract rule: listIds and the auth header travel together.
      if (content.includes('listIds')) {
        expect(content, `${adapter} states listIds without the auth header`).toContain(
          'X-OAuth-Token',
        )
      }
    }
  })

  it('live docs do not link retired surfaces', () => {
    for (const doc of LIVE_DOCS) {
      const content = read(doc)
      expect(content, `${doc} links the deleted ASTRID_WORKFLOW.md copy`).not.toMatch(
        /\]\(\.?\/?ASTRID_WORKFLOW\.md\)|public\/ASTRID_WORKFLOW\.md/,
      )
      expect(content, `${doc} links the archived docs/ai-agents walkthrough`).not.toMatch(
        /\]\(\.?\/?(docs\/)?ai-agents\//,
      )
    }
  })

  it('retired surfaces stay retired, with the walkthrough archived not deleted', () => {
    expect(fs.existsSync(path.join(root, 'ASTRID_WORKFLOW.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'public/ASTRID_WORKFLOW.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'docs/ai-agents'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'docs/archive/ai-agents/README.md'))).toBe(true)
  })
})
