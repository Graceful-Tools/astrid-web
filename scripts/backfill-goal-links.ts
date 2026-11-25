#!/usr/bin/env npx tsx
/**
 * One-off: turn existing `GOAL: g1` work-report comments into `GoalLink` rows with
 * `source: "report"` (ADEV-271). `workByGoal` reads the table now, so without this the
 * per-goal counts of work reported before the table existed would drop to zero.
 *
 * Only goals a project of the task's lists still states are linked, as on the live write path
 * (`linkGoalsFromReport`). Idempotent: an existing link is left as it is.
 *
 * Usage:
 *   npx tsx scripts/backfill-goal-links.ts            # dry run
 *   npx tsx scripts/backfill-goal-links.ts --apply    # writes
 *   npx tsx scripts/backfill-goal-links.ts --prod     # against production
 */
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

import { createScriptPrisma } from './lib/script-prisma'
import { goalIdsServed, storedGoalsAndGuardrails } from '../lib/goals-guardrails'

async function main() {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const prod = argv.includes('--prod')
  const url = prod ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL
  if (!url) throw new Error(prod ? 'DATABASE_URL_PROD is not set in .env.local' : 'DATABASE_URL is not set in .env.local')

  const prisma = createScriptPrisma({ url })
  try {
    const comments = await prisma.comment.findMany({
      where: { content: { contains: 'GOAL:' }, task: { lists: { some: { projectId: { not: null } } } } },
      select: {
        taskId: true,
        authorId: true,
        content: true,
        task: { select: { lists: { select: { project: { select: { id: true, goalsAndGuardrails: true } } } } } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const wanted = new Map<string, { taskId: string; projectId: string; goalId: string; createdById: string }>()
    for (const comment of comments) {
      const ids = goalIdsServed(comment.content)
      if (!ids.length) continue
      const projects = new Map(comment.task.lists.flatMap(l => (l.project ? [[l.project.id, l.project] as const] : [])))
      for (const project of projects.values()) {
        const stated = new Set(storedGoalsAndGuardrails(project.goalsAndGuardrails as never).goals.map(g => g.id))
        for (const goalId of ids) {
          if (!stated.has(goalId)) continue
          const key = `${comment.taskId}|${project.id}|${goalId}`
          if (!wanted.has(key)) wanted.set(key, { taskId: comment.taskId, projectId: project.id, goalId, createdById: comment.authorId ?? 'system' })
        }
      }
    }

    console.log(`${comments.length} comments name a goal; ${wanted.size} links to make${apply ? '' : ' (dry run, pass --apply to write)'}`)
    if (!apply) return
    const result = await prisma.goalLink.createMany({
      data: [...wanted.values()].map(link => ({ ...link, source: 'report' })),
      skipDuplicates: true,
    })
    console.log(`created ${result.count} links`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
