/**
 * AWTD-879: no agent-facing document may claim that pushing `main` ships.
 *
 * Jon: ".claude/commands/fixall.md is still wrong about push being a production
 * deploy. This run is now direct evidence: I pushed at 12:45 and nothing
 * happened until I dispatched the workflow separately. That's the fifth time
 * that claim has misled someone."
 *
 * FIVE times. Three of them by inferring the trigger from the Vercel deployment
 * list, where an Actions deploy appears as `source=cli` and reads as "a human
 * did this". Another said "deploys are MANUAL" on the strength of a check made
 * 2m40s into a ~10-minute pipeline. Every previous fix was another paragraph
 * asking the next reader to be careful, and the claim came back anyway — so
 * this is a check instead.
 *
 * It is written the way the rule says to establish the fact: read
 * `.github/workflows/production-deployment.yml`, never a deployment list and
 * never the prose. The workflow's trigger block is the ground truth, and the
 * docs are then held to it.
 *
 * The false premise is not harmless on its own, either. Because fixall.md
 * believed pushing shipped, it also told the loop NEVER to push — so finished
 * work sat unpushed and unreviewable, which is exactly what CLAUDE.md rule 3
 * ("Push finished work without asking") exists to prevent. A wrong fact about
 * the pipeline turns into a wrong instruction about the work.
 *
 * If merging is ever MEANT to ship, restore the trigger first. This test then
 * fails on the workflow, which is the right place to be arguing about it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const WORKFLOW = '.github/workflows/production-deployment.yml'

/** Everything between `on:` and the next top-level key. */
function triggerBlock(source: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex(line => /^on:\s*$/.test(line))
  expect(start, `${WORKFLOW} has no top-level "on:" block`).toBeGreaterThanOrEqual(0)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^[A-Za-z]/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * The documents an agent actually reads before deciding whether to push.
 *
 * Deliberately not every .md in the repo: docs/archive/ is a record of what was
 * true when it was written, and rewriting history to match today's pipeline
 * would destroy the evidence of how this claim kept coming back.
 */
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
  const slashCommands = existsSync(commands)
    ? readdirSync(commands)
        .filter(name => name.endsWith('.md'))
        .map(name => `.claude/commands/${name}`)
    : []

  return [...named, ...slashCommands]
}

/**
 * Prose asserting that a push to main deploys or ships.
 *
 * Matched on the CLAIM, not on the words. "pushing to `main` does NOT ship" and
 * "Pushing is not shipping" are the CORRECT statements and both contain every
 * keyword, so a keyword search would flag the fixes and miss the bug. Sentences
 * that deny the claim are dropped first; what remains is searched for an
 * assertion.
 */
const CLAIMS_PUSH_DEPLOYS = [
  /push(?:ing)?[^.]{0,60}\bmain\b[^.]{0,80}\bis a (?:production )?deploy/i,
  /`?git push origin main`?[^.]{0,80}\b(?:is|means)\b[^.]{0,40}\bdeploy/i,
  /push(?:ing)?[^.]{0,60}\bmain\b[^.]{0,60}\b(?:ships|deploys to production)\b/i,
  /merging[^.]{0,40}\b(?:ships|deploys)\b(?! nothing)/i,
]

/** Sentences that DENY the claim, which must not be mistaken for making it. */
const DENIALS = [
  /\bdoes NOT ship\b/i,
  /\bis not (?:a )?(?:shipping|deploy)/i,
  /\bships nothing\b/i,
  /\bdo not restore\b/i,
]

/**
 * Sentences, from Markdown that wraps them.
 *
 * Two things this has to get right, and the first draft of this test got both
 * wrong — it reported four false positives, all of them correct prose:
 *
 * SPLITTING ON NEWLINES CUTS SENTENCES IN HALF. "Pushing `main` ships nothing
 * (rule 1), so it is how work becomes reviewable" wraps after "ships", and the
 * fragment left behind says the opposite of the sentence. Paragraphs are joined
 * before they are split.
 *
 * BLOCKQUOTES ARE THE RETROSPECTIVE REGISTER in these documents. CLAUDE.md §1
 * and docs/CLI_OPERATIONS.md §0 both use `>` to quote the wrong claim back and
 * explain how it got there — "A fourth version — *pushing to `main` ships* —
 * was correct when written and..." That history is the most valuable prose on
 * the subject, and a check that forced it to be deleted would be destroying the
 * record of the very mistake it exists to prevent.
 */
function sentencesClaimingPushDeploys(source: string): string[] {
  return source
    .split(/\n\s*\n/)
    .filter(paragraph => !paragraph.trim().split('\n').every(line => line.trim().startsWith('>')))
    // Whitespace is collapsed as well as joined: a wrapped list item rejoins as
    // "ships    nothing" on the continuation indent, and a denial matched with
    // \b...\b misses it by four spaces.
    .flatMap(paragraph => paragraph.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/))
    .map(sentence => sentence.trim())
    .filter(sentence => sentence && !DENIALS.some(denial => denial.test(sentence)))
    .filter(sentence => CLAIMS_PUSH_DEPLOYS.some(claim => claim.test(sentence)))
}

describe('pushing main does not deploy (AWTD-879)', () => {
  const workflow = readFileSync(join(ROOT, WORKFLOW), 'utf8')

  it('is true by construction: the production workflow is dispatch-only', () => {
    const triggers = triggerBlock(workflow)

    expect(triggers).toMatch(/^\s*workflow_dispatch:/m)
    // The two that made merging (and, for `closed`, even an UNMERGED close)
    // ship. Removed in #204; commented out of existence, not deleted, so the
    // reasoning survives — hence matching on a real key rather than the word.
    expect(triggers).not.toMatch(/^\s{2}push:/m)
    expect(triggers).not.toMatch(/^\s{2}pull_request:/m)
  })

  it('and no document an agent reads says otherwise', () => {
    const offenders = agentFacingDocs().flatMap(doc => {
      const source = readFileSync(join(ROOT, doc), 'utf8')
      return sentencesClaimingPushDeploys(source).map(
        sentence => `${doc}: ${sentence.slice(0, 160)}`,
      )
    })

    expect(
      offenders,
      'These say pushing main ships. It does not — the workflow above is ' +
        'workflow_dispatch only. Fix the prose, or restore the trigger if ' +
        'merging is now meant to deploy.',
    ).toEqual([])
  })

  it('recognises the claim it is looking for, so it cannot pass by matching nothing', () => {
    expect(
      sentencesClaimingPushDeploys('On web, `git push origin main` **is a production deploy**.'),
    ).toHaveLength(1)
    expect(sentencesClaimingPushDeploys('Pushing to `main` ships to production.')).toHaveLength(1)
  })

  it('does not mistake the correct statements for the claim', () => {
    const correct = [
      'Production deploys are MANUAL — pushing to `main` does NOT ship.',
      'Pushing is not shipping in either repo.',
      'Pushing `main` ships nothing, so it is how work becomes reviewable.',
      'Do not restore either trigger without deciding that merging should ship.',
    ]
    for (const sentence of correct) {
      expect(sentencesClaimingPushDeploys(sentence), sentence).toEqual([])
    }
  })
})
