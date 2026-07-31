/**
 * Human-readable task identifiers — AST-142 (task 12f54df4).
 *
 * A UUID is unspeakable: you cannot put it in a branch name, a commit message,
 * a PR title or a standup. `Shortcode` is the wrong shape for this — it has
 * `clicks`, `expiresAt` and `isActive`, i.e. it is a share link, not an
 * identity.
 *
 * Scope is the **project**. A task on a project-less list gets no identifier at
 * all, so a solo user never sees one — the progressive-disclosure rule.
 *
 * Identifiers are permanent once minted and never reused, including after
 * delete: a branch named `ast-142-...` must not come to mean a different task.
 */

/** Project keys are short enough to type and long enough to disambiguate. */
export const MIN_PROJECT_KEY_LENGTH = 2
export const MAX_PROJECT_KEY_LENGTH = 5

const IDENTIFIER_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,4})-(\d+)$/

export interface ParsedIdentifier {
  key: string
  sequence: number
}

/**
 * Parse "AST-142" into its parts, or null when it isn't an identifier.
 *
 * Case-insensitive on input (people type `ast-142`), canonical uppercase on
 * output — the same identifier must not resolve two different ways.
 */
export function parseIdentifier(value: string | null | undefined): ParsedIdentifier | null {
  if (typeof value !== 'string') return null
  const match = IDENTIFIER_PATTERN.exec(value.trim())
  if (!match) return null

  const sequence = Number(match[2])
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null

  return { key: match[1].toUpperCase(), sequence }
}

export function formatIdentifier(key: string, sequence: number): string {
  return `${key.toUpperCase()}-${sequence}`
}

/**
 * Derive a candidate project key from its name.
 *
 * Initials of the first words when there are several ("Astrid Web To-do" →
 * "AWT"), otherwise the leading letters of the single word ("Astrid" → "AST").
 * Digits are kept when they carry meaning ("Project 42" → "P4"), because
 * stripping them produces surprising keys.
 *
 * Returns null when the name has nothing usable — the caller falls back rather
 * than minting a meaningless key.
 */
export function deriveProjectKey(name: string): string | null {
  const cleaned = (name || '').trim()
  if (!cleaned) return null

  const words = cleaned
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return null

  const candidate = words.length > 1
    ? words.map(word => word[0]).join('')
    : words[0]

  const normalized = candidate
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, MAX_PROJECT_KEY_LENGTH)

  if (normalized.length === 0) return null
  // A key must start with a letter so it can never be confused with a bare
  // sequence number.
  if (!/^[A-Z]/.test(normalized)) return null

  // Pad a one-character key rather than rejecting it: "X" → "XX" is ugly but
  // usable, and refusing would leave the project with no identifier at all.
  return normalized.length < MIN_PROJECT_KEY_LENGTH
    ? normalized.padEnd(MIN_PROJECT_KEY_LENGTH, normalized[0])
    : normalized
}

/**
 * Pick a key that doesn't collide with any the owner already uses.
 *
 * Appends a digit ("AST" → "AST2"), staying inside the length cap. Collisions
 * are resolved per owner rather than globally: two people may both have an
 * "AST", and forcing global uniqueness would hand out increasingly ugly keys
 * for no benefit.
 */
export function resolveProjectKeyCollision(
  candidate: string,
  taken: Iterable<string>
): string {
  const used = new Set(Array.from(taken, key => key.toUpperCase()))
  if (!used.has(candidate)) return candidate

  const base = candidate.slice(0, MAX_PROJECT_KEY_LENGTH - 1)
  for (let suffix = 2; suffix <= 9; suffix++) {
    const next = `${base}${suffix}`
    if (!used.has(next)) return next
  }

  // Exhausted the single-digit space: widen to two digits, trimming the base.
  const shortBase = candidate.slice(0, Math.max(1, MAX_PROJECT_KEY_LENGTH - 2))
  for (let suffix = 10; suffix <= 99; suffix++) {
    const next = `${shortBase}${suffix}`
    if (!used.has(next)) return next
  }

  return candidate
}

/**
 * Git branch name for a task: `ast-142-fix-repeating-rollover`.
 *
 * Must be a valid ref, so: lowercase, no consecutive or trailing separators,
 * no leading/trailing dots, and bounded length. This is the payoff of the
 * whole feature — the identifier travelling outside the product.
 */
export function toBranchName(identifier: string, title: string, maxLength = 60): string {
  const slug = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const prefix = identifier.toLowerCase()
  if (!slug) return prefix

  return `${prefix}-${slug}`.slice(0, maxLength).replace(/-+$/, '')
}

// ─── Allocation (server-only below this line) ───────────────────────────────

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type PrismaLike = typeof prisma | Prisma.TransactionClient

/**
 * Atomically take the next sequence number for a project.
 *
 * `UPDATE ... RETURNING` rather than `SELECT max()+1`: concurrent creation from
 * web, iOS, MCP and agents is the normal case here, not an edge case, and a
 * read-then-write would hand the same number to two tasks. Postgres serializes
 * the row update, so N concurrent callers get N distinct values.
 */
export async function allocateSequence(
  projectId: string,
  client: PrismaLike = prisma
): Promise<number | null> {
  const rows = await client.$queryRaw<Array<{ nextSequence: number }>>(
    Prisma.sql`
      UPDATE "Project"
      SET "nextSequence" = "nextSequence" + 1
      WHERE "id" = ${projectId}
      RETURNING "nextSequence" - 1 AS "nextSequence"
    `
  )
  return rows[0]?.nextSequence ?? null
}

/**
 * Ensure a project has a key, deriving one from its name if it doesn't.
 *
 * Idempotent, and safe under concurrency: a unique violation on (ownerId, key)
 * means another request just picked the same key, so we re-read rather than
 * fail the task creation that triggered this.
 */
export async function ensureProjectKey(
  projectId: string,
  client: PrismaLike = prisma
): Promise<string | null> {
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: { id: true, key: true, name: true, ownerId: true },
  })
  if (!project) return null
  if (project.key) return project.key

  const candidate = deriveProjectKey(project.name)
  if (!candidate) return null

  const siblings = await client.project.findMany({
    where: { ownerId: project.ownerId, key: { not: null } },
    select: { key: true },
  })
  const key = resolveProjectKeyCollision(
    candidate,
    siblings.map(sibling => sibling.key as string)
  )

  try {
    await client.project.update({ where: { id: projectId }, data: { key } })
    return key
  } catch {
    const reread = await client.project.findUnique({
      where: { id: projectId },
      select: { key: true },
    })
    return reread?.key ?? null
  }
}

/**
 * Mint an identifier for a task, given the lists it belongs to.
 *
 * Returns null when none of the lists belongs to a project — the solo case,
 * where no identifier should exist at all.
 */
export async function allocateTaskIdentifier(
  listIds: string[],
  client: PrismaLike = prisma
): Promise<{ identifier: string; sequence: number } | null> {
  if (!listIds.length) return null

  // The first list with a project wins. A task in two projects is not a
  // meaningful concept today (a project owns one domain list), and picking
  // deterministically beats minting two identifiers for one task.
  const list = await client.taskList.findFirst({
    where: { id: { in: listIds }, projectId: { not: null } },
    select: { projectId: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!list?.projectId) return null

  const key = await ensureProjectKey(list.projectId, client)
  if (!key) return null

  const sequence = await allocateSequence(list.projectId, client)
  if (sequence === null) return null

  return { identifier: formatIdentifier(key, sequence), sequence }
}

/**
 * Resolve either a task UUID or a human-readable identifier to a task id.
 *
 * Returns the input unchanged when it isn't identifier-shaped, so every
 * existing UUID call site behaves exactly as before and this is purely
 * additive. Returns null only when an identifier-shaped value matches nothing.
 *
 * Access control is the caller's job — this only maps one name to another.
 */
export async function resolveTaskIdOrIdentifier(
  value: string,
  client: PrismaLike = prisma
): Promise<string | null> {
  const parsed = parseIdentifier(value)
  if (!parsed) return value

  const task = await client.task.findUnique({
    where: { identifier: formatIdentifier(parsed.key, parsed.sequence) },
    select: { id: true },
  })
  return task?.id ?? null
}
