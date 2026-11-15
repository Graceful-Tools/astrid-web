/**
 * RULE — the runtime-binding schema is additive and survives its people (AWTD-1666).
 *
 * docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §9 step 1: add the binding,
 * revision and audit records and a nullable board association "without changing
 * any existing column/default, removing data or adding a required field to old
 * rows". §4: owner deletion "must not cascade them or clear board associations
 * into legacy mode" — a NULL runtimeBindingId means "today's resolver", so a
 * key that nulled it on delete would silently turn a denied business board back
 * into a personal one.
 *
 * This pins both halves without a database. That schema.prisma and the chain
 * agree is checked for real by `prisma migrate diff --exit-code` in
 * tests/integration/postgres-risk.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findDestructiveStatements } from '@/scripts/lib/destructive-migrations'

const ROOT = process.cwd()
const MIGRATION = join(ROOT, 'prisma/migrations/20261115120000_add_runtime_binding/migration.sql')
const sql = readFileSync(MIGRATION, 'utf8')
const statements = sql
  .replace(/--[^\n]*/g, '')
  .split(';')
  .map(s => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')

const NEW_TABLES = ['RuntimeBinding', 'RuntimeBindingRevision', 'RuntimeBindingAuditEvent']

function modelBody(model: string): string {
  const match = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'))
  if (!match) throw new Error(`model ${model} not found in schema.prisma`)
  return match[1]
}

function fieldLine(model: string, field: string): string {
  const line = modelBody(model)
    .split('\n')
    .find(l => new RegExp(`^\\s*${field}\\s`).test(l))
  if (!line) throw new Error(`${model}.${field} not found`)
  return line
}

describe('runtime-binding migration is additive (AWTD-1666)', () => {
  it('has nothing the destructive-migration detector flags', () => {
    expect(findDestructiveStatements(sql)).toEqual([])
  })

  it('writes no rows and changes no existing column, default or constraint', () => {
    for (const statement of statements) {
      // Referential actions are clauses of a new key, not statements.
      const s = statement.replace(/ON (UPDATE|DELETE) (RESTRICT|CASCADE)/g, '')
      expect(s).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|RENAME|TRUNCATE)\b/i)
      expect(s).not.toMatch(/ALTER COLUMN|SET NOT NULL|SET DEFAULT/i)
    }
  })

  it('touches only one pre-existing table, TaskList, with a nullable no-default column, its index and its key', () => {
    const subject = (s: string) => (s.match(/^(?:CREATE|ALTER) TABLE "(\w+)"/) ?? s.match(/ INDEX "\w+" ON "(\w+)"/))?.[1]
    const touchingOld = statements.filter(s => !NEW_TABLES.includes(subject(s) ?? ''))
    expect(touchingOld).toEqual([
      'ALTER TABLE "TaskList" ADD COLUMN "runtimeBindingId" TEXT',
      'CREATE INDEX "TaskList_runtimeBindingId_idx" ON "TaskList"("runtimeBindingId")',
      'ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_runtimeBindingId_fkey" FOREIGN KEY ("runtimeBindingId") REFERENCES "RuntimeBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
    ])
  })

  it('never cascades or nulls on delete', () => {
    const keys = statements.filter(s => /FOREIGN KEY/.test(s))
    expect(keys.length).toBe(4)
    for (const k of keys) expect(k).toMatch(/ON DELETE RESTRICT/)
    expect(sql).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT)/)
  })

  it('takes the TaskList locks last, so ACCESS EXCLUSIVE is held for the least time', () => {
    const onTaskList = (s: string) => /^ALTER TABLE "TaskList"| ON "TaskList"\(/.test(s)
    const firstTaskList = statements.findIndex(onTaskList)
    const lastNewTable = statements.map(s => !onTaskList(s)).lastIndexOf(true)
    expect(firstTaskList).toBeGreaterThan(lastNewTable)
  })
})

describe('runtime-binding schema (AWTD-1666)', () => {
  it('TaskList.runtimeBindingId is optional with no default', () => {
    const line = fieldLine('TaskList', 'runtimeBindingId')
    expect(line).toMatch(/runtimeBindingId\s+String\?/)
    expect(line).not.toMatch(/@default/)
  })

  it('board and owner relations restrict deletion', () => {
    expect(fieldLine('TaskList', 'runtimeBinding')).toMatch(/onDelete: Restrict/)
    expect(fieldLine('RuntimeBinding', 'owner')).toMatch(/onDelete: Restrict/)
    expect(fieldLine('RuntimeBindingRevision', 'binding')).toMatch(/onDelete: Restrict/)
    expect(fieldLine('RuntimeBindingAuditEvent', 'binding')).toMatch(/onDelete: Restrict/)
  })

  it('a binding starts pending, at concurrency one', () => {
    expect(fieldLine('RuntimeBinding', 'state')).toMatch(/@default\("pending"\)/)
    expect(fieldLine('RuntimeBinding', 'maxConcurrentRuns')).toMatch(/@default\(1\)/)
  })

  it('one snapshot per binding revision', () => {
    expect(modelBody('RuntimeBindingRevision')).toMatch(/@@unique\(\[bindingId, revision\]\)/)
  })
})
