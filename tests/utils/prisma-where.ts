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

import { readFileSync } from 'fs'
import { join } from 'path'
import { Prisma } from '@prisma/client'

const COMBINATORS = new Set(['AND', 'OR', 'NOT'])

/**
 * The `where` names of a model's compound `@@unique` / `@@id` keys
 * (`userId_installationId`). Prisma 7's runtime DMMF no longer carries
 * uniqueIndexes or primaryKey (AWTD-1408), so they are read from the schema.
 */
function compoundKeyNames(model: string): string[] {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
  const block = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)?.[1] ?? ''
  const names: string[] = []
  for (const match of block.matchAll(/@@(?:unique|id)\(\[([^\]]+)\](?:[^)]*?name:\s*"([^"]+)")?/g)) {
    names.push(match[2] ?? match[1].split(',').map(field => field.trim().split('(')[0]).join('_'))
  }
  return names
}

export function unknownWhereFields(model: Prisma.ModelName, where: Record<string, unknown>): string[] {
  const definition = Prisma.dmmf.datamodel.models.find(m => m.name === model)
  if (!definition) throw new Error(`No Prisma model named ${model}`)

  const known = new Set<string>(definition.fields.map(f => f.name))
  for (const name of compoundKeyNames(model)) known.add(name)

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
