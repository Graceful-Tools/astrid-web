/**
 * Nothing an agent reads while composing a board message still says iOS chat
 * renders inline markdown only.
 *
 * It did until astrid-ios AITD-416 routed the chat bubble and the task-comment
 * bubble through the shared block renderer (merged 2026-09-19, confirmed
 * installed 2026-09-20). docs/FIXALL_WORKFLOW.md was updated; the header of
 * scripts/post-list-message.ts was not, so the two disagreed — and the header
 * is the copy that wins, because it is what you read in the moment you write
 * the message. It told agents to flatten summaries into **bold** labels and
 * bullets, which is now strictly worse output than plain markdown.
 *
 * Pinned as a rule over all the agent-facing copy rather than as a one-line
 * edit to that header: the claim was duplicated once and would be again, and a
 * stale rendering caveat is invisible — it degrades output without failing
 * anything. (AWTD-999)
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()

/** The copy an agent reads when deciding how to write for the phone. */
const SCANNED_DIRS = ['scripts', 'docs', join('.claude', 'commands')]
const SCANNED_FILES = ['CLAUDE.md', 'AGENTS.md', 'ASTRID.md', 'CODEX.md', 'GEMINI.md']
const SCANNED_EXTENSIONS = ['.ts', '.md']

/**
 * Narrow patterns, deliberately. "inline" is an ordinary word in this repo
 * (inlined env vars, InlineDatePicker, inlined permission checks), so the rule
 * matches only the specific claim about the iOS renderer.
 */
const STALE_CLAIMS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /inlineOnlyPreservingWhitespace/,
    why: 'names the SwiftUI inline-only renderer the chat bubble no longer uses',
  },
  {
    pattern: /inline markdown only/i,
    why: 'says iOS renders inline markdown only',
  },
  {
    pattern: /inline[-\s]only/i,
    why: 'calls the iOS chat renderer inline-only',
  },
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (entry === 'node_modules' || entry.startsWith('.next')) return []
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const files = [
  ...SCANNED_DIRS.filter(dir => existsSync(join(ROOT, dir))).flatMap(dir => walk(join(ROOT, dir))),
  ...SCANNED_FILES.map(file => join(ROOT, file)).filter(existsSync),
].filter(file => SCANNED_EXTENSIONS.some(extension => file.endsWith(extension)))

describe('agent-facing chat copy (AWTD-999)', () => {
  it('actually scans the file that carries the advice', () => {
    expect(files).toContain(join(ROOT, 'scripts', 'post-list-message.ts'))
  })

  it.each(STALE_CLAIMS)('never claims iOS chat is inline-only — $why', ({ pattern, why }) => {
    const offenders = files.filter(file => pattern.test(readFileSync(file, 'utf8')))
    expect(
      offenders.map(file => relative(ROOT, file)),
      `these files still tell agents iOS chat ${why}; block markdown has rendered since AITD-416`
    ).toEqual([])
  })

  it('post-list-message.ts tells the composer that block markdown renders', () => {
    const header = readFileSync(join(ROOT, 'scripts', 'post-list-message.ts'), 'utf8').split(
      /^import /m
    )[0]

    expect(header, 'the header should cite the iOS change that made block markdown render').toMatch(
      /AITD-416/
    )
    expect(header, 'the header should say headings/bullets/code blocks draw').toMatch(/headings/i)
  })

  it('still warns about the two things that have not changed', () => {
    const header = readFileSync(join(ROOT, 'scripts', 'post-list-message.ts'), 'utf8').split(
      /^import /m
    )[0]

    expect(header, 'the leading ! of the task-link syntax is easy to drop').toMatch(
      /!\[Title\]\(taskId\)/
    )
    expect(header, 'mentions are the only thing that fires a push notification').toMatch(
      /@\[Name\]\(userId\)/
    )
  })
})
