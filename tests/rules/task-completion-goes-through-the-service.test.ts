/**
 * RULE — AWTD-1093.
 *
 * Completing a task is not a column write. `updateTaskWithSideEffects` stamps
 * completedAt/completedSource, clears the board lane (AWTD-562), promotes the
 * tasks it was blocking (AWTD-1002), rolls a repeating series forward, cancels
 * reminders, records events and broadcasts. A raw
 * `prisma.task.update({ data: { completed: true } })` does none of it: blocked
 * tasks stay blocked, a repeating series silently dies, and nobody else sees
 * the change.
 *
 * Five such writes had accumulated in agent webhooks, the coding workflow and
 * system tasks, plus the GitHub Issues sync. This bans `completed:` in a task
 * update outside services/, whatever its value — a raw reopen skips the
 * stashed-lane restore just as a raw complete skips the clear.
 *
 * The scan reads each call's argument list by matching parentheses, so a
 * `completed: false` in an unrelated `findFirst` above an update is not
 * mistaken for part of it.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCANNED = ['app', 'lib', 'mcp']

/** Service-internal helpers that run INSIDE updateTaskWithSideEffects. */
const ALLOWED: Record<string, string> = {
  'lib/repeating-task-handler.ts':
    'roll-forward reopens the next occurrence; called only by services/task.service.ts, which runs the side effects',
}

const TASK_UPDATE_CALL = /\b(?:prisma|tx|client|this\.prisma)\.task\.(?:update|updateMany|upsert)\(/g

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** The text between a call's opening paren and its matching close. */
function argumentsOf(source: string, openParen: number): string {
  let depth = 0
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')' && --depth === 0) return source.slice(openParen + 1, i)
  }
  return source.slice(openParen + 1)
}

function rawCompletionWrites(source: string): number {
  let count = 0
  for (const match of source.matchAll(TASK_UPDATE_CALL)) {
    const args = argumentsOf(source, match.index! + match[0].length - 1)
    if (/\bcompleted\s*:/.test(args)) count++
  }
  return count
}

describe('task completion goes through the service (AWTD-1093)', () => {
  it('finds a raw completion when one is planted — the scan is not vacuously green', () => {
    expect(rawCompletionWrites(`await prisma.task.update({ where: { id }, data: { completed: true } })`)).toBe(1)
    expect(rawCompletionWrites(`await tx.task.updateMany({ where: { id: { in: ids } }, data: { completed: item.done } })`)).toBe(1)
    expect(
      rawCompletionWrites(
        `const t = await prisma.task.findFirst({ where: { completed: false } })\nawait prisma.task.update({ where: { id: t.id }, data: { title } })`,
      ),
    ).toBe(0)
  })

  it('has no raw completed: write outside services/', () => {
    const offenders = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir)))
      .map(file => relative(ROOT, file))
      .filter(file => !(file in ALLOWED))
      .filter(file => rawCompletionWrites(readFileSync(join(ROOT, file), 'utf8')) > 0)

    expect(
      offenders,
      `These write Task.completed directly:\n${offenders.map(f => `  ${f}`).join('\n')}\n\n` +
        `Complete or reopen through updateTaskWithSideEffects (services/task.service.ts) so the ` +
        `stamp, the board lane, blocked dependents, repeating roll-forward, reminders, events ` +
        `and SSE all happen.`,
    ).toEqual([])
  })

  it('keeps every allow-list entry honest', () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(rawCompletionWrites(readFileSync(join(ROOT, file), 'utf8')), file).toBeGreaterThan(0)
    }
  })
})
