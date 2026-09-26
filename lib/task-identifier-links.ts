/**
 * Task ids in prose — autolinking and the show rule (AWTD-1017,
 * docs/specs/TASK_IDENTIFIERS.md §5–7).
 *
 * Both are pinned to tests/fixtures/task-identifiers.json, the contract iOS and
 * Windows copy, so the three clients link and show ids the same way.
 *
 * Client-safe: no Prisma here (lib/task-identifier.ts carries the server half).
 */
import { MAX_PROJECT_KEY_LENGTH, formatIdentifier } from '@/lib/task-identifier-core'

export interface IdentifierLinkContext {
  /** The project whose task or chat this text belongs to — enables `#N`. */
  projectKey?: string | null
  /**
   * Project keys the reader can see. Only these link, which is what keeps
   * `UTF-8` and `COVID-19` prose and never links a project the reader cannot
   * open. Rendering still costs no per-reference lookup.
   */
  keys: Iterable<string>
  /** Individual ids known to be hidden from the reader. */
  hidden?: Iterable<string>
}

export interface IdentifierLink {
  /** The text as written — `AWTD-12` or `#12`. */
  match: string
  /** Canonical id — always `KEY-N`. */
  identifier: string
  href: string
  index: number
}

// Full form: uppercase only in prose, so a branch name like awtd-12-fix stays
// text. Not after a word character, a hyphen, a slash or a dot (URLs, paths,
// `XAWTD-1`), and not before one.
const FULL_FORM = new RegExp(
  `(?<![A-Za-z0-9_\\-/.#])([A-Z][A-Z0-9]{1,${MAX_PROJECT_KEY_LENGTH - 1}})-(\\d+)(?![A-Za-z0-9_\\-])`,
  'g'
)
// Short form: `#N` — not an HTML entity (`&#12;`), not a heading (`# 12`).
const SHORT_FORM = /(?<![A-Za-z0-9_&#/])#(\d+)(?![A-Za-z0-9_])/g

/** Code and URLs are masked to spaces so offsets stay true to the input. */
const MASKS = [/```[\s\S]*?```/g, /`[^`\n]*`/g, /\bhttps?:\/\/\S+/g]

function mask(text: string): string {
  return MASKS.reduce((acc, pattern) => acc.replace(pattern, m => ' '.repeat(m.length)), text)
}

export function findIdentifierLinks(text: string, context: IdentifierLinkContext): IdentifierLink[] {
  if (!text) return []
  const keys = new Set(Array.from(context.keys, key => key.toUpperCase()))
  if (keys.size === 0) return []
  const hidden = new Set(Array.from(context.hidden ?? [], id => id.toUpperCase()))
  const visible = (identifier: string) => !hidden.has(identifier)
  const masked = mask(text)
  const links: IdentifierLink[] = []

  for (const m of masked.matchAll(FULL_FORM)) {
    const sequence = Number(m[2])
    if (!keys.has(m[1]) || !Number.isSafeInteger(sequence) || sequence < 1) continue
    const identifier = formatIdentifier(m[1], sequence)
    if (visible(identifier)) links.push({ match: m[0], identifier, href: `/t/${identifier}`, index: m.index! })
  }

  const projectKey = context.projectKey?.toUpperCase()
  if (projectKey && keys.has(projectKey)) {
    for (const m of masked.matchAll(SHORT_FORM)) {
      const sequence = Number(m[1])
      if (!Number.isSafeInteger(sequence) || sequence < 1) continue
      const identifier = formatIdentifier(projectKey, sequence)
      if (visible(identifier)) links.push({ match: m[0], identifier, href: `/t/${identifier}`, index: m.index! })
    }
  }

  return links.sort((a, b) => a.index - b.index)
}

/** Replace each link with `render(link)`; the rest of the text is untouched. */
export function replaceIdentifierLinks(
  text: string,
  context: IdentifierLinkContext,
  render: (link: IdentifierLink) => string
): string {
  let out = ''
  let cursor = 0
  for (const link of findIdentifierLinks(text, context)) {
    out += text.slice(cursor, link.index) + render(link)
    cursor = link.index + link.match.length
  }
  return out + text.slice(cursor)
}

export type IdentifierSurface = 'details' | 'row-board' | 'row-list'

interface IdentifiedTask {
  identifier?: string | null
  lists?: Array<{ projectId?: string | null }> | null
}

/**
 * THE show rule — one helper, never open-coded per component (§7).
 *
 * Shown when the task has an id AND sits on a project list; in rows only on
 * board views. A task moved out of every project keeps its id for links and
 * search but stops displaying it.
 */
export function shouldShowTaskIdentifier(task: IdentifiedTask, surface: IdentifierSurface): boolean {
  if (!task.identifier || surface === 'row-list') return false
  return (task.lists ?? []).some(list => Boolean(list.projectId))
}

/** "Copy task id" is offered whenever an id exists, shown or not. */
export function canCopyTaskIdentifier(task: IdentifiedTask): boolean {
  return Boolean(task.identifier)
}
