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

// The format itself is client-safe and lives in task-identifier-core (AWTD-1017).
import {
  MIN_PROJECT_KEY_LENGTH,
  MAX_PROJECT_KEY_LENGTH,
  parseIdentifier,
  formatIdentifier,
  normalizeProjectKey,
  deriveProjectKey,
} from '@/lib/task-identifier-core'
export {
  MIN_PROJECT_KEY_LENGTH,
  MAX_PROJECT_KEY_LENGTH,
  parseIdentifier,
  formatIdentifier,
  normalizeProjectKey,
  deriveProjectKey,
  type ParsedIdentifier,
} from '@/lib/task-identifier-core'

/**
 * Pick a key that doesn't collide with any key already taken on astrid.cc.
 *
 * Appends a digit ("AST" → "AST2"), staying inside the length cap. Collisions
 * are resolved across every owner, not per owner (AWTD-1016): `Task.identifier`
 * is globally unique, so two owners sharing "AST" would both mint AST-1 and
 * every task create in the second project would fail on that index. A global
 * key is also what lets `AST-142` name one task anywhere it is typed.
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
): Promise<{ sequence: number; key: string | null } | null> {
  const range = await allocateSequenceRange(projectId, 1, client)
  return range ? { sequence: range.firstSequence, key: range.key } : null
}

/**
 * Take `count` consecutive sequence numbers in one statement (AWTD-1124): a
 * bulk create pays one row lock per project, not one per task. Returns the
 * first; the batch owns `firstSequence … firstSequence + count - 1`.
 */
export async function allocateSequenceRange(
  projectId: string,
  count: number,
  client: PrismaLike = prisma
): Promise<{ firstSequence: number; key: string | null } | null> {
  // The key comes back from the same row lock as the number (AWTD-1024): a
  // create that read AWTD just before a rename to WEB committed would otherwise
  // mint AWTD-13 after every other AWTD-N had become WEB-N.
  // `${count}` is a bound parameter Postgres types as bigint, and int4 - int8
  // is int8, which $queryRaw hands back as a JS BigInt — and task.create
  // rejects a BigInt for the Int `sequence` column. That 500'd every task
  // create on a project board in production (2026-10-09). Keep the arithmetic
  // in integer, and coerce anyway: the column type is the database's to change.
  const rows = await client.$queryRaw<Array<{ nextSequence: number | bigint; key: string | null }>>(
    Prisma.sql`
      UPDATE "Project"
      SET "nextSequence" = "nextSequence" + ${count}::integer
      WHERE "id" = ${projectId}
      RETURNING ("nextSequence" - ${count}::integer)::integer AS "nextSequence", "key"
    `
  )
  const row = rows[0]
  return row ? { firstSequence: Number(row.nextSequence), key: row.key } : null
}

/**
 * May `key` become a project key? (AWTD-1024)
 *
 * No when another project holds it, when it is an alias another project
 * renamed away from, or when ids with that prefix already exist — a project
 * deleted with its tasks still carrying `OLD-N` would otherwise hand those
 * numbers out twice. `forProjectId`'s own alias does not count: taking an old
 * key back is allowed.
 */
async function isProjectKeyTaken(
  key: string,
  client: PrismaLike,
  forProjectId?: string
): Promise<boolean> {
  const holder = await client.project.findUnique({ where: { key }, select: { id: true } })
  if (holder) return holder.id !== forProjectId
  const alias = await client.projectKeyAlias.findUnique({ where: { key }, select: { projectId: true } })
  if (alias) return alias.projectId !== forProjectId
  const minted = await client.task.findFirst({
    where: { identifier: { startsWith: `${key}-` } },
    select: { id: true },
  })
  return Boolean(minted)
}

/**
 * Ensure a project has a key, deriving one from its name if it doesn't.
 *
 * Idempotent, and safe under concurrency: a unique violation on `key` means
 * another request just picked the same key, so we re-read rather than fail the
 * task creation that triggered this.
 */
/**
 * Check a key the owner typed at project creation (AWTD-1018, spec §3).
 *
 * Absent → `{ key: null }`, and the key is derived from the name as before.
 * Malformed → 400; held by any project on astrid.cc → 409. The unique index
 * remains the backstop for two creates racing for one key.
 */
export async function checkRequestedProjectKey(
  value: unknown,
  client: PrismaLike = prisma
): Promise<{ key: string | null } | { error: string; status: 400 | 409 }> {
  if (value === undefined || value === null || value === '') return { key: null }
  const key = normalizeProjectKey(value)
  if (!key) {
    return {
      error: `A key is ${MIN_PROJECT_KEY_LENGTH}–${MAX_PROJECT_KEY_LENGTH} letters or digits, starting with a letter`,
      status: 400,
    }
  }
  if (await isProjectKeyTaken(key, client)) return { error: `The key ${key} is already taken`, status: 409 }
  return { key }
}

export async function ensureProjectKey(
  projectId: string,
  client: PrismaLike = prisma
): Promise<string | null> {
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: { id: true, key: true, name: true },
  })
  if (!project) return null
  if (project.key) return project.key

  const candidate = deriveProjectKey(project.name)
  if (!candidate) return null

  // Every key on astrid.cc, not just this owner's (AWTD-1016), and every key a
  // rename left behind as an alias (AWTD-1024).
  const [taken, aliases] = await Promise.all([
    client.project.findMany({ where: { key: { not: null } }, select: { key: true } }),
    client.projectKeyAlias.findMany({ select: { key: true } }),
  ])
  const key = resolveProjectKeyCollision(candidate, [
    ...taken.map(other => other.key as string),
    ...aliases.map(alias => alias.key),
  ])

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

  if (!(await ensureProjectKey(list.projectId, client))) return null

  const allocated = await allocateSequence(list.projectId, client)
  if (!allocated?.key) return null

  return { identifier: formatIdentifier(allocated.key, allocated.sequence), sequence: allocated.sequence }
}

export type RenameProjectKeyResult =
  | { key: string; previousKey: string | null }
  | { error: string; status: 400 | 404 | 409 }

/**
 * Rename a project's key after tasks exist (AWTD-1024, spec W4).
 *
 * One transaction: the old key becomes an alias, the project takes the new
 * one, and every `OLD-N` is rebuilt as `NEW-N` from its stored sequence, so a
 * task keeps its number. Only ids exactly `OLD-<its own sequence>` move — the
 * key is globally unique, so those are all this project's. A task that has
 * since moved to another board keeps its first id (spec §4), and that id is
 * this project's to rename.
 *
 * Taking back one of the project's own old keys drops that alias, since the
 * key is a real key again.
 */
export async function renameProjectKey(
  projectId: string,
  value: unknown,
  client: typeof prisma = prisma
): Promise<RenameProjectKeyResult> {
  const key = normalizeProjectKey(value)
  if (!key) {
    return {
      error: `A key is ${MIN_PROJECT_KEY_LENGTH}–${MAX_PROJECT_KEY_LENGTH} letters or digits, starting with a letter`,
      status: 400,
    }
  }

  return client.$transaction(async tx => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { key: true } })
    if (!project) return { error: 'Project not found', status: 404 as const }
    if (project.key === key) return { key, previousKey: key }

    if (await isProjectKeyTaken(key, tx, projectId)) {
      return { error: `The key ${key} is already taken`, status: 409 as const }
    }

    await tx.projectKeyAlias.deleteMany({ where: { key, projectId } })
    if (project.key) {
      await tx.projectKeyAlias.create({ data: { key: project.key, projectId } })
    }
    await tx.project.update({ where: { id: projectId }, data: { key } })
    if (project.key) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Task"
        SET "identifier" = ${key} || '-' || "sequence"
        WHERE "identifier" = ${project.key} || '-' || "sequence"
      `)
    }
    return { key, previousKey: project.key }
  })
}

/**
 * The identifier a task carries today for something typed as `value` —
 * `AWTD-12` → `WEB-12` once AWTD was renamed to WEB (AWTD-1024). Renames
 * chain: every old key's alias points at the project, not at the next key.
 *
 * Returns the normalized input when no alias applies, and null when `value` is
 * not identifier-shaped at all.
 */
export async function canonicalizeIdentifier(
  value: string,
  client: PrismaLike = prisma
): Promise<string | null> {
  const parsed = parseIdentifier(value)
  if (!parsed) return null
  const alias = await client.projectKeyAlias.findUnique({
    where: { key: parsed.key },
    select: { project: { select: { key: true } } },
  })
  return formatIdentifier(alias?.project?.key ?? parsed.key, parsed.sequence)
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

  const exact = formatIdentifier(parsed.key, parsed.sequence)
  const task = await client.task.findUnique({ where: { identifier: exact }, select: { id: true } })
  if (task) return task.id

  // A renamed key (AWTD-1024): the miss path only, so a current id costs one read.
  const current = await canonicalizeIdentifier(exact, client)
  if (!current || current === exact) return null
  const renamed = await client.task.findUnique({ where: { identifier: current }, select: { id: true } })
  return renamed?.id ?? null
}
