/**
 * Field names in a Prisma `where` that the model does not have.
 *
 * A Prisma mock accepts any argument, and tsc does not catch an unknown key
 * nested in `updateMany({ where })` (Prisma's SelectSubset skips excess
 * property checks there). So a mock-based test can assert a query shape that
 * the real client rejects on every call — which is exactly how AWTD-1090
 * shipped: `task.updateMany({ where: { listId } })` on a model with no
 * `listId`, pinned green by a test that asserted that very shape.
 *
 * Checks the top level and the AND/OR/NOT combinators against the generated
 * schema. Relation filters (`lists: { some: … }`) are checked by name only.
 */

import { Prisma } from '@prisma/client'

const COMBINATORS = new Set(['AND', 'OR', 'NOT'])

export function unknownWhereFields(model: Prisma.ModelName, where: Record<string, unknown>): string[] {
  const definition = Prisma.dmmf.datamodel.models.find(m => m.name === model)
  if (!definition) throw new Error(`No Prisma model named ${model}`)

  const known = new Set<string>(definition.fields.map(f => f.name))
  for (const index of definition.uniqueIndexes) known.add(index.name ?? index.fields.join('_'))
  if (definition.primaryKey) known.add(definition.primaryKey.name ?? definition.primaryKey.fields.join('_'))

  const unknown: string[] = []
  const visit = (clause: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(clause)) {
      if (COMBINATORS.has(key)) {
        for (const nested of Array.isArray(value) ? value : [value]) {
          if (nested && typeof nested === 'object') visit(nested as Record<string, unknown>)
        }
      } else if (!known.has(key)) {
        unknown.push(key)
      }
    }
  }
  visit(where)
  return unknown
}

/**
 * Field names in a Prisma `select` that the model does not have, nested
 * relation selects included (reported as `relation.field`).
 *
 * The same blind spot as `where`: tsc accepts an unknown key inside a nested
 * `select`, and a mock returns whatever it is told. AWTD-1284: the recurrence
 * job selected `binding.listId`, which GitHubProjectBinding never had, so every
 * spawn failed on its first query while its tests stayed green.
 */
export function unknownSelectFields(model: Prisma.ModelName, select: Record<string, unknown>): string[] {
  const definition = Prisma.dmmf.datamodel.models.find(m => m.name === model)
  if (!definition) throw new Error(`No Prisma model named ${model}`)

  const unknown: string[] = []
  for (const [key, value] of Object.entries(select)) {
    if (key === '_count') continue
    const field = definition.fields.find(f => f.name === key)
    if (!field) {
      unknown.push(key)
      continue
    }
    const nested = value && typeof value === 'object' ? (value as { select?: Record<string, unknown> }).select : undefined
    if (nested && field.kind === 'object') {
      unknown.push(...unknownSelectFields(field.type as Prisma.ModelName, nested).map(name => `${key}.${name}`))
    }
  }
  return unknown
}
