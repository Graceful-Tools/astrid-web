/**
 * Is the generated Prisma client still in sync with prisma/schema.prisma?
 *
 * `require('@prisma/client')` — what the predeploy "Prisma Client" check used
 * to run — resolves against a stale client just as happily as a fresh one, so
 * a schema change surfaced instead as a wall of `Property 'x' does not exist on
 * type '{ ...model fields... }'` errors from tsc (task ea700455).
 *
 * `prisma generate` stores the schema it generated from alongside the client,
 * so drift is a comparison between that copy and the source of truth. It is a
 * whitespace-normalized comparison, not a byte one: `prisma generate` re-aligns
 * the column padding in its stored copy, so identical schemas differ on disk
 * every time and a byte comparison would report drift on every run.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const SCHEMA_PATH = 'prisma/schema.prisma'
export const GENERATED_SCHEMA_PATH = 'node_modules/.prisma/client/schema.prisma'

function normalize(schema: string): string {
  return schema
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

export function isPrismaClientStale(root: string = process.cwd()): boolean {
  const generated = path.join(root, GENERATED_SCHEMA_PATH)
  if (!existsSync(generated)) return true

  const source = path.join(root, SCHEMA_PATH)
  if (!existsSync(source)) return false // nothing to be stale against

  return normalize(readFileSync(source, 'utf8')) !== normalize(readFileSync(generated, 'utf8'))
}
