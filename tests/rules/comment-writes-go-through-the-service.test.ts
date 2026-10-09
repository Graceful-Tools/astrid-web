/**
 * RULE — P1 step 4 of docs/specs/GITHUB_PROJECTS_WHITELABEL.md.
 *
 * Every user-facing comment route creates through createCommentWithSideEffects,
 * which broadcasts to the list, persists in-app notifications, pushes to
 * mentioned people and runs the workflow and agent side effects. The comments
 * agents and the coding workflow wrote — fourteen raw `prisma.comment.create`
 * calls — did none of it, several not even SSE, so an agent's reply appeared
 * only after a refresh and nobody was notified of it.
 *
 * Agent and system authors now go through services/post-comment-as.ts. The
 * allow-list is the service's own helpers and history copies, where firing
 * notifications would be wrong.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCANNED = ['app', 'lib', 'mcp']

const ALLOWED: Record<string, string> = {
  'lib/comments/create-comment.ts': "the comment service's own idempotent insert",
  'lib/task-update-handler.ts': 'state-change system comments written inside updateTaskWithSideEffects',
  'lib/copy-utils.ts': 'copying a task copies its history; re-notifying everyone would be wrong',
}

const RAW_COMMENT_CREATE =
  /\b(?:prisma|tx|client|this\.prisma)\.comment\.(?:create|createMany)\(|\bcomments\s*:\s*\{\s*create\b/

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

describe('comment writes go through the comment service', () => {
  it('recognises a raw create — the scan is not vacuously green', () => {
    expect(RAW_COMMENT_CREATE.test(`await prisma.comment.create({ data })`)).toBe(true)
    expect(RAW_COMMENT_CREATE.test(`await tx.comment.createMany({ data: rows })`)).toBe(true)
    expect(RAW_COMMENT_CREATE.test(`prisma.task.update({ data: { comments: { create: { content } } } })`)).toBe(true)
    expect(RAW_COMMENT_CREATE.test(`await prisma.comment.findMany({ where })`)).toBe(false)
  })

  it('has no raw comment create outside services/', () => {
    const offenders = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir)))
      .map(file => relative(ROOT, file))
      .filter(file => !(file in ALLOWED))
      .filter(file => RAW_COMMENT_CREATE.test(readFileSync(join(ROOT, file), 'utf8')))

    expect(
      offenders,
      `These create comments directly:\n${offenders.map(f => `  ${f}`).join('\n')}\n\n` +
        'Use postCommentAs (services/post-comment-as.ts) for agent and system authors, or ' +
        'createCommentWithSideEffects (services/comment.service.ts) on a request surface.',
    ).toEqual([])
  })

  it('keeps every allow-list entry honest', () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(RAW_COMMENT_CREATE.test(readFileSync(join(ROOT, file), 'utf8')), file).toBe(true)
    }
  })
})
