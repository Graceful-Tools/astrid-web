/**
 * One definition of "prefix-redundant", shared by the rule test and the
 * production evidence script.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED. `tests/rules/schema-redundant-indexes.test.ts`
 * pins the count of prefix-redundant indexes; `scripts/index-drop-evidence.ts`
 * gathers the production evidence that decides which of them may go. If those
 * two disagreed about what counts as redundant, the evidence would be gathered
 * for one list and the gate enforced on another — the exact failure the pinned
 * count exists to prevent. They import from here instead.
 */

import { readFileSync } from 'node:fs'

export interface ModelIndexes {
  model: string
  indexes: string[][]
  uniqueFields: string[]
  uniqueComposites: string[][]
}

/** A single-column @@index whose column also leads at least one composite. */
export interface PrefixRedundantIndex {
  model: string
  column: string
  /** The composites that already lead with this column. */
  covering: string[][]
  /** The Postgres relation name Prisma generates for this index. */
  indexName: string
}

export function parsePrismaSchema(path = 'prisma/schema.prisma'): ModelIndexes[] {
  const src = readFileSync(path, 'utf8')
  const models = [...src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]

  return models.map(([, model, body]) => ({
    model,
    indexes: [...body.matchAll(/@@index\(\[([^\]]+)\]/g)].map(m =>
      m[1].split(',').map(s => s.trim().replace(/\(.*\)$/, '')),
    ),
    uniqueFields: [...body.matchAll(/^\s*(\w+)\s+\S+.*@unique/gm)].map(m => m[1]),
    uniqueComposites: [...body.matchAll(/@@unique\(\[([^\]]+)\]/g)].map(m =>
      m[1].split(',').map(s => s.trim()),
    ),
  }))
}

export const sameColumns = (a: string[], b: string[]) =>
  a.length === b.length && a.every((c, i) => c === b[i])

/**
 * Single-column indexes sitting under a composite that starts with the same
 * column. Redundant for the *lookup*, but not unconditionally redundant: the
 * narrow index is physically smaller, so a plan scanning much of it touches
 * fewer pages. Which is why dropping one wants a production plan, not a guess.
 */
export function findPrefixRedundantIndexes(
  schema: ModelIndexes[] = parsePrismaSchema(),
): PrefixRedundantIndex[] {
  const found: PrefixRedundantIndex[] = []

  for (const { model, indexes } of schema) {
    for (const index of indexes) {
      if (index.length !== 1) continue
      const covering = indexes.filter(other => other.length > 1 && other[0] === index[0])
      if (covering.length === 0) continue
      found.push({
        model,
        column: index[0],
        covering,
        indexName: `${model}_${index[0]}_idx`,
      })
    }
  }

  return found
}

/** `TaskList.@@index([ownerId]) ⊂ [ownerId, isFavorite]` — the test's message format. */
export function describePrefixRedundant(entry: PrefixRedundantIndex): string {
  return `${entry.model}.@@index([${entry.column}]) ⊂ ${entry.covering
    .map(c => `[${c.join(', ')}]`)
    .join(', ')}`
}
