#!/usr/bin/env npx tsx
/**
 * Read-only per-arm report for the hide_list_images A/B test.
 *
 * Usage:
 *   npx tsx scripts/list-image-experiment-report.ts               # local database
 *   npx tsx scripts/list-image-experiment-report.ts --prod        # production
 *   npx tsx scripts/list-image-experiment-report.ts --prod --days 28
 *
 * No exposure logging exists, and none is needed: arms are recomputed with the
 * SAME evaluateFeatureFlag the app serves (lib/feature-flags.ts), so a user's
 * arm here is exactly the one /api/v1/features gave them. While the flag is
 * still OFF it reports the split the configured percentage WOULD make, so a
 * pre-launch baseline uses the same arms.
 *
 * "Opted in/out" is the user's explicit User.showListImages, which wins over
 * the flag (lib/list-images-visibility.ts): opted-in in the hidden arm is the
 * demand for images; opted-out in the shown arm is the demand for their absence.
 *
 * READ-ONLY: selects only. `--prod` repoints DATABASE_URL for this process.
 */

import { loadScriptEnv } from './lib/load-env'
import { applyDatabaseTarget } from './lib/database-target'

loadScriptEnv()

export {}

type Arm = 'hidden' | 'shown'
interface ArmStats {
  users: number
  active: number
  tasksCreated: number
  tasksCompleted: number
  listsCreated: number
  optedIn: number
  optedOut: number
}

async function main() {
  const args = process.argv.slice(2)
  const useProd = args.includes('--prod')
  const daysArg = args.indexOf('--days')
  const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 14
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days must be a positive number')
    process.exit(1)
  }

  try {
    applyDatabaseTarget({ useProd })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const { prisma } = await import('../lib/prisma')
  const { evaluateFeatureFlag } = await import('../lib/feature-flags')
  const { HIDE_LIST_IMAGES_FEATURE_KEY } = await import('../lib/list-images-visibility')

  const flag = await prisma.featureFlag.findUnique({
    where: { key: HIDE_LIST_IMAGES_FEATURE_KEY },
    include: { targets: { select: { userId: true, treatment: true } } },
  })
  if (!flag) {
    console.error(`No ${HIDE_LIST_IMAGES_FEATURE_KEY} flag row — has the migration been deployed?`)
    process.exit(1)
  }
  const live = flag.enabled && flag.rolloutMode !== 'OFF'
  // Before launch, project the split the configured percentage would make.
  const evaluated = {
    key: flag.key,
    enabled: true,
    rolloutMode: (live ? flag.rolloutMode : 'PERCENTAGE') as 'OFF' | 'ALL' | 'PERCENTAGE' | 'SELECTED_USERS',
    rolloutPercentage: flag.rolloutPercentage,
    targets: flag.targets as Array<{ userId: string; treatment: 'INCLUDE' | 'EXCLUDE' }>,
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const users = await prisma.user.findMany({
    where: { isAIAgent: false, isPlaceholder: false },
    select: { id: true, showListImages: true },
  })
  const events = await prisma.analyticsEvent.groupBy({
    by: ['userId', 'eventType'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  })
  const byUser = new Map<string, Map<string, number>>()
  for (const e of events) {
    const m = byUser.get(e.userId) ?? new Map<string, number>()
    m.set(e.eventType, e._count._all)
    byUser.set(e.userId, m)
  }

  const blank = (): ArmStats => ({ users: 0, active: 0, tasksCreated: 0, tasksCompleted: 0, listsCreated: 0, optedIn: 0, optedOut: 0 })
  const stats: Record<Arm, ArmStats> = { hidden: blank(), shown: blank() }
  for (const user of users) {
    const s = stats[evaluateFeatureFlag(evaluated, user.id) ? 'hidden' : 'shown']
    s.users++
    if (user.showListImages === true) s.optedIn++
    if (user.showListImages === false) s.optedOut++
    const m = byUser.get(user.id)
    if (!m) continue
    s.active++
    s.tasksCreated += m.get('task_created') ?? 0
    s.tasksCompleted += m.get('task_completed') ?? 0
    s.listsCreated += m.get('list_added') ?? 0
  }

  const perActive = (n: number, s: ArmStats) => (s.active ? (n / s.active).toFixed(2) : '—')
  console.log(`\nhide_list_images — ${useProd ? 'production' : 'local'}, last ${days}d (since ${since.toISOString().slice(0, 10)})`)
  console.log(
    live
      ? `  rollout: ${flag.rolloutMode}${flag.rolloutMode === 'PERCENTAGE' ? ` ${flag.rolloutPercentage}%` : ''}, ${flag.targets.length} target(s)`
      : `  ⚠️  flag is OFF — arms below are the PROJECTED ${flag.rolloutPercentage}% split (a pre-launch baseline)`
  )
  console.log('')
  console.log('  arm      users  active  tasks+/active  done/active  lists+  opted-in  opted-out')
  for (const arm of ['hidden', 'shown'] as const) {
    const s = stats[arm]
    console.log(
      `  ${arm.padEnd(7)} ${String(s.users).padStart(6)} ${String(s.active).padStart(7)} ` +
        `${perActive(s.tasksCreated, s).padStart(14)} ${perActive(s.tasksCompleted, s).padStart(12)} ` +
        `${String(s.listsCreated).padStart(7)} ${String(s.optedIn).padStart(9)} ${String(s.optedOut).padStart(10)}`
    )
  }
  console.log('\n  opted-in = chose to SHOW images; opted-out = chose to HIDE them (User.showListImages).')
  await prisma.$disconnect()
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
