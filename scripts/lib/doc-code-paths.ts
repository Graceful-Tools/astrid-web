/**
 * Extract the repository paths a Markdown file mentions in backticks or table
 * cells, so scripts/check-doc-links.ts can verify they still exist (task
 * ff74f430).
 *
 * The link checker already validates Markdown links. It never looked at the far
 * more common form — a path written as inline code in prose or a reference
 * table — which is how ASTRID.md came to point at `lib/ai-agent-config.ts` and
 * document four hooks that do not exist.
 *
 * FENCED BLOCKS ARE DELIBERATELY SKIPPED. They hold illustrative snippets
 * (`app/api/[resource]/route.ts`), import specifiers, shell transcripts and
 * ASCII directory trees whose lines are not paths at all. Enforcing those would
 * mean either a parser per fence language or a wall of false positives, and the
 * drift this is aimed at lives in prose and tables.
 */

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.sql', '.sh', '.yml', '.yaml', '.prisma', '.md',
])

/** Placeholders, globs and shell/JS syntax that mean "not a literal path". */
const NOT_A_LITERAL_PATH = /[[\]{}*<>$()|"'\\!?=,;]|\.\.\./

/**
 * Not in the repository by construction: build output, and per-machine files a
 * setup guide legitimately tells a reader to create.
 */
const IGNORED_PREFIXES = [
  'node_modules/', '.next/', 'dist/', 'build/', 'coverage/',
  '.auth/', '.vscode/', '.idea/',
]

export interface CodePathReference {
  path: string
  line: number
}

/**
 * Blanks fenced-code lines while preserving line numbering, so reported line
 * numbers still point at the right place in the original file.
 */
export function stripFencedBlocks(source: string): string {
  let inFence = false
  return source
    .split('\n')
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return ''
      }
      return inFence ? '' : line
    })
    .join('\n')
}

function isCandidate(raw: string): boolean {
  if (!raw.includes('/')) return false
  // Whitespace means a command line ("npm test tests/x.test.ts"), not a path.
  if (/\s/.test(raw)) return false
  if (NOT_A_LITERAL_PATH.test(raw)) return false
  // A leading slash is a URL route ("/.well-known/ai-plugin.json"), and a
  // leading ~ is the reader's home directory. Neither is a repository path.
  if (raw.startsWith('/') || raw.startsWith('~')) return false
  if (IGNORED_PREFIXES.some(prefix => raw.startsWith(prefix))) return false
  // A bare scheme or protocol-relative reference is a URL, not a path.
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return false
  // Package specifiers (@scope/name) are not repo paths.
  if (raw.startsWith('@')) return false

  const withoutLineSuffix = raw.replace(/:\d+(-\d+)?$/, '')
  if (withoutLineSuffix.endsWith('/')) return true

  const extension = withoutLineSuffix.slice(withoutLineSuffix.lastIndexOf('.'))
  return CODE_EXTENSIONS.has(extension)
}

/** Strips a `:12` / `:12-30` line reference, which is not part of the path. */
export function normalizeCodePath(raw: string): string {
  return raw.replace(/:\d+(-\d+)?$/, '')
}

export function extractCodePathReferences(source: string): CodePathReference[] {
  const prose = stripFencedBlocks(source)
  const found = new Map<string, number>()

  prose.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const raw = match[1].trim()
      if (!isCandidate(raw)) continue
      const path = normalizeCodePath(raw)
      if (!found.has(path)) found.set(path, index + 1)
    }
  })

  return [...found].map(([path, line]) => ({ path, line }))
}

/**
 * The docs an agent is told to trust, and which therefore have to be right.
 *
 * Deliberately not "every Markdown file". docs/archive/ and docs/fixes/ are
 * historical write-ups that describe the tree as it was, docs/prompts/ holds
 * templates whose paths are illustrative by design, and enforcing either would
 * mean rewriting history to satisfy a lint. This set is meant to GROW: moving a
 * document in here is the way to promise it stays accurate.
 */
export const AUTHORITATIVE_DOCS = [
  'ASTRID.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CODEX.md',
  'GEMINI.md',
  'README.md',
  'SECURITY.md',
  'docs/README.md',
  'docs/ARCHITECTURE.md',
  'docs/WHITELABELING.md',
  'docs/CLI_OPERATIONS.md',
  'docs/API_CONTRACT.md',
  'docs/PRODUCT_CONTRACT.md',
  'docs/CODE_REUSE_AND_CONSISTENCY.md',
  'docs/context/stack.md',
  'docs/context/conventions.md',
  'docs/context/testing.md',
] as const

/**
 * Paths that are missing ON PURPOSE. Each entry needs a reason, because the
 * cheap way out of a failure here is to add a line rather than fix a document.
 */
export const INTENTIONALLY_MISSING: Record<string, string> = {
  '.codex/': 'AGENTS.md names it precisely to say the broken CLAUDE.md copy invented it.',
  'components/foo.tsx': 'CODEX.md uses it to show the file:line reference FORMAT, not a real file.',
  '.claude/settings.local.json':
    'Per-machine and gitignored — the file a developer creates from .claude/settings.json.example. ' +
    'It was tracked until 747cb68 untracked it, at which point every doc citing it became a path ' +
    'that resolves on the author\'s machine and nowhere else.',
  '.vercel/project.json':
    'Per-machine and gitignored — written by the Vercel CLI on link. docs/CLI_OPERATIONS.md cites ' +
    'it to say what the CLI leaves behind, not to promise the repository contains it.',
}

/**
 * Which cited paths git refuses to track.
 *
 * This exists because "does the file exist" is the WRONG question when the
 * checker runs on a developer machine: a gitignored file is present for the
 * author and absent in every clone, so the suite passed locally and failed in
 * CI — seven minutes into a production deploy, with the deploy job skipped
 * behind it. A path that git ignores must be declared in INTENTIONALLY_MISSING
 * with a reason, so the verdict is the same everywhere.
 *
 * Returns [] when git is unavailable: this is a guard against drift, not a
 * reason to fail a build that has no repository to ask.
 */
export function findGitIgnoredCodePaths(root: string): BrokenCodePath[] {
   
  const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs')
   
  const { dirname, join, resolve } = require('node:path') as typeof import('node:path')
   
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')

  const cited: BrokenCodePath[] = []
  for (const file of AUTHORITATIVE_DOCS) {
    const absolute = join(root, file)
    if (!existsSync(absolute)) continue
    for (const reference of extractCodePathReferences(readFileSync(absolute, 'utf8'))) {
      if (reference.path in INTENTIONALLY_MISSING) continue
      // Same exclusion findBrokenCodePaths makes, and for the same reason:
      // ASTRID.md's `../CLAUDE.md` points at the parent workspace on purpose.
      // It also has to happen HERE rather than being left to git, which treats
      // a path outside the repository as a fatal error and abandons the whole
      // batch — one such citation silently emptied this guard's answer.
      const fromRoot = resolve(root, reference.path)
      const fromDoc = resolve(dirname(absolute), reference.path)
      if (!fromRoot.startsWith(root) && !fromDoc.startsWith(root)) continue
      cited.push({ file, ...reference })
    }
  }
  if (cited.length === 0) return []

  let stdout: string
  try {
    stdout = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: root,
      input: cited.map(c => c.path).join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    const status = (error as { status?: number }).status
    // 1 is check-ignore's normal "nothing matched".
    if (status === 1) return []
    // Anything else is git failing, not git answering. Returning [] here is
    // what made the first version of this guard a no-op that reported success.
    if (status === undefined) return []
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim()
    throw new Error(`git check-ignore failed (exit ${status}): ${stderr}`)
  }

  const ignored = new Set(stdout.split('\n').filter(Boolean))
  return cited.filter(c => ignored.has(c.path))
}

export interface BrokenCodePath extends CodePathReference {
  file: string
}

/**
 * A path counts as resolved if it exists relative to the repository root or to
 * the document citing it — both conventions are in use (docs/README.md writes
 * `archive/` meaning docs/archive/). Anything resolving outside the repository
 * is skipped: ASTRID.md's `../CLAUDE.md` points at the parent workspace on
 * purpose, and this checker has no business asserting what is out there.
 */
export function findBrokenCodePaths(root: string): BrokenCodePath[] {
  // Imported lazily so the pure extractor above stays usable without fs.
   
  const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs')
   
  const { dirname, join, resolve } = require('node:path') as typeof import('node:path')

  const broken: BrokenCodePath[] = []

  for (const file of AUTHORITATIVE_DOCS) {
    const absolute = join(root, file)
    if (!existsSync(absolute)) {
      broken.push({ file, line: 0, path: '(document itself is missing)' })
      continue
    }

    for (const reference of extractCodePathReferences(readFileSync(absolute, 'utf8'))) {
      if (reference.path in INTENTIONALLY_MISSING) continue

      const fromRoot = resolve(root, reference.path)
      const fromDoc = resolve(dirname(absolute), reference.path)
      const insideRepo = fromRoot.startsWith(root) || fromDoc.startsWith(root)
      if (!insideRepo) continue
      if (existsSync(fromRoot) || existsSync(fromDoc)) continue

      broken.push({ file, ...reference })
    }
  }

  return broken
}
