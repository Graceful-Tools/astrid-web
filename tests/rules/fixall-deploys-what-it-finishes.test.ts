/**
 * AWTD-1250 — the loop's finish line is production, and it must be written down
 * where the loop actually reads it.
 *
 * Jon, 2026-10-13: *"Don't move to done until deployed to prod. You can deploy to
 * prod if all tests are green."* Then, asked whether that covered the unattended
 * runner as well as an interactive session: *"Interactive sessions and automatic
 * can deploy with clean tests and monitor to make sure it works. Don't block on
 * me."*
 *
 * WHY A TEST AND NOT A PARAGRAPH. The old finish line — "DONE when it is
 * committed on its branch with `npm run predeploy` green" — let three things be
 * called done that no user could reach: AWTD-839 sat committed-not-pushed for
 * seventeen days, AWTD-1039 pushed with no PR for four, then with a red check
 * nobody saw. A *scheduled* run reads these files, not the conversation that
 * changed the rule, so prose that still says NEVER DEPLOY would quietly restore
 * the old behaviour on the next tick. That is the same failure mode as AWTD-879,
 * where four paragraphs asking the reader to be careful lost to one stale
 * sentence, and the answer there was a check too.
 *
 * WHAT THIS DOES NOT LOOSEN. The trigger is still `workflow_dispatch` only and
 * pushing still ships nothing — `pushing-main-does-not-deploy.test.ts` owns that
 * and must keep passing. What changed is *who may dispatch it*, not what a push
 * does. And the one case that stays human-gated is pinned below, because it is
 * the case that cannot be undone by redeploying.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

/** The documents a `/fixall` run reads before deciding whether to deploy. */
const LOOP_DOCS = [
  '.claude/commands/fixall.md',
  'docs/FIXALL_WORKFLOW.md',
  'docs/CLI_OPERATIONS.md',
  'CLAUDE.md',
].filter(path => existsSync(join(ROOT, path)))

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * Sentences, from Markdown that wraps them — and never from a blockquote.
 *
 * Borrowed deliberately from pushing-main-does-not-deploy.test.ts, for the same
 * reason: `>` is the retrospective register in these documents. "This bullet
 * said NEVER DEPLOY for a long time, and here is why that changed" is the most
 * useful prose on the subject, and a check that forced its deletion would be
 * erasing the record of the decision it exists to protect.
 */
function sentences(source: string): string[] {
  return source
    .split(/\n\s*\n/)
    .filter(paragraph => !paragraph.trim().split('\n').every(line => line.trim().startsWith('>')))
    .flatMap(paragraph => paragraph.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/))
    .map(sentence => sentence.trim())
    .filter(Boolean)
}

/**
 * Prose forbidding the loop from deploying at all.
 *
 * Matched on the PROHIBITION, not on the word "deploy". The documents are full
 * of correct sentences about deploying — "a destructive migration needs a human",
 * "never deploy on a red gate" — and those must survive. What may not survive is
 * a blanket ban, or an instruction to wait for a go-ahead that Jon has now given.
 */
const BANS_DEPLOYING = [
  /\bNEVER DEPLOY\b/,
  /\bnever deploy\b(?![^.]{0,40}\b(?:on|with|without|while|when|a destructive|a red|unverified|untested)\b)/i,
  /\bdo not deploy\b(?![^.]{0,40}\b(?:on|with|without|while|when|a destructive|a red|unverified|untested|it yourself)\b)/i,
  /deploying waits for an explicit go-ahead/i,
  /\bask (?:first |Jon )?before deploy/i,
  /\bask before DEPLOYING\b/i,
]

/** The old finish line, which stopped before anyone could use the work. */
const STALE_DONE = [
  /\bis DONE when it is committed on its branch\b/i,
  /report what is ready to ship instead of shipping it/i,
  /\bSay "?ready to ship"?,? not "?shipped"?/i,
]

describe('the loop deploys what it finishes (AWTD-1250)', () => {
  it('no document an agent reads forbids it from deploying', () => {
    const offenders = LOOP_DOCS.flatMap(doc =>
      sentences(read(doc))
        .filter(sentence => BANS_DEPLOYING.some(ban => ban.test(sentence)))
        .map(sentence => `${doc}: ${sentence.slice(0, 160)}`),
    )

    expect(
      offenders,
      'These forbid the deploy that is now the finish line (Jon, 2026-10-13: ' +
        '"Interactive sessions and automatic can deploy with clean tests"). ' +
        'A scheduled run reads these files, not the conversation.',
    ).toEqual([])
  })

  it('and none still defines done as merely committed with predeploy green', () => {
    const offenders = LOOP_DOCS.flatMap(doc =>
      sentences(read(doc))
        .filter(sentence => STALE_DONE.some(stale => stale.test(sentence)))
        .map(sentence => `${doc}: ${sentence.slice(0, 160)}`),
    )

    expect(
      offenders,
      'Done now means production serves it. This wording is what let AWTD-839 ' +
        'sit committed-but-unpushed for seventeen days while the board said done.',
    ).toEqual([])
  })

  it('the loop docs state the condition on deploying: the gates, green', () => {
    for (const doc of ['.claude/commands/fixall.md', 'docs/FIXALL_WORKFLOW.md']) {
      const source = read(doc)
      expect(source, `${doc} must name the gate that licenses a deploy`).toMatch(
        /predeploy/i,
      )
      expect(source, `${doc} must say the deploy follows a GREEN gate`).toMatch(
        /green/i,
      )
    }
  })

  it('and require the deploy to be verified against what production serves', () => {
    // "Monitor to make sure it works" is the other half of the permission, and
    // it is not satisfied by the CLI saying it succeeded: on 2026-09-18 the job
    // reported FAILED about a deploy that had gone out, and on another run the
    // rule was restated from a check made 2m40s into a ~10-minute pipeline.
    for (const doc of ['.claude/commands/fixall.md', 'docs/FIXALL_WORKFLOW.md']) {
      const source = read(doc)
      expect(source, `${doc} must say how to verify the deploy landed`).toMatch(
        /commitSha|verify-deployed-sha/,
      )
    }
  })

  it('keeps the one case a human still has to answer for', () => {
    // The migration job runs BEFORE the deploy and does not depend on it, so a
    // DROP lands while the code that stops reading it is still pending. That
    // took production down on 2026-09-18 and a redeploy could not undo it.
    // `allow_destructive_migrations` is the workflow's own human gate; the
    // automation must not learn to pass it.
    const fixall = read('.claude/commands/fixall.md')
    expect(fixall, 'fixall.md must carve out the irreversible case').toMatch(
      /destructive|allow_destructive_migrations/i,
    )
  })

  it('does not loosen what a push does', () => {
    // Belt and braces with pushing-main-does-not-deploy.test.ts. Widening the
    // deploy permission must not slide into "merging ships" — the trigger is
    // still dispatch-only, and the workflow is where that argument belongs.
    const workflow = readFileSync(join(ROOT, '.github/workflows/production-deployment.yml'), 'utf8')
    // Line-wise, like the sibling ratchet. Slicing from `\non:` and searching
    // for the next `\n<letter>` matches at offset 0 — the `on:` line itself —
    // and silently yields an empty block that passes `not.toMatch`.
    const lines = workflow.split('\n')
    const start = lines.findIndex(line => /^on:\s*$/.test(line))
    expect(start, 'the workflow has no top-level "on:" block').toBeGreaterThanOrEqual(0)
    const rest = lines.slice(start + 1)
    const end = rest.findIndex(line => /^[A-Za-z]/.test(line))
    const triggers = (end === -1 ? rest : rest.slice(0, end)).join('\n')

    expect(triggers).toMatch(/^\s*workflow_dispatch:/m)
    expect(triggers).not.toMatch(/^\s{2}push:/m)
  })

  it('recognises the prohibitions it looks for, so it cannot pass by matching nothing', () => {
    expect(sentences('**NEVER DEPLOY. Not once.**').filter(s => BANS_DEPLOYING.some(b => b.test(s))))
      .toHaveLength(1)
    expect(
      sentences('So deploying waits for an explicit go-ahead; report what is ready to ship.')
        .filter(s => BANS_DEPLOYING.some(b => b.test(s))),
    ).toHaveLength(1)
    expect(
      sentences('A task is DONE when it is committed on its branch with predeploy green.')
        .filter(s => STALE_DONE.some(b => b.test(s))),
    ).toHaveLength(1)
  })

  it('does not mistake the surviving rules for a blanket ban', () => {
    // Every one of these must still be sayable after this change.
    const correct = [
      'Never deploy on a red gate.',
      'Do not deploy with a pending destructive migration — that one needs Jon.',
      'A destructive migration still waits for a human, because a DROP cannot be undone by redeploying.',
      'Deploy it yourself once the gates are green, then verify `commitSha`.',
      'Production deploys are MANUAL — pushing to `main` does NOT ship.',
    ]
    for (const sentence of correct) {
      expect(
        sentences(sentence).filter(s => BANS_DEPLOYING.some(ban => ban.test(s))),
        sentence,
      ).toEqual([])
    }
  })
})
