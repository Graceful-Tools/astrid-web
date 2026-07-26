#!/usr/bin/env tsx

/**
 * Weekly Product Review Script
 *
 * Gathers data from analytics DB, Vercel deployments, public lists,
 * and local codebase to produce a unified weekly health report.
 *
 * Usage:
 *   npm run weekly-review              # Print report to stdout
 *   npm run weekly-review:save         # Also save to logs/weekly-review/
 */

import { execSync } from 'child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

const prisma = new PrismaClient({
  log: ['error'],
})

const NOW = new Date()
const SEVEN_DAYS_AGO = new Date(NOW)
SEVEN_DAYS_AGO.setDate(SEVEN_DAYS_AGO.getDate() - 7)
const FOURTEEN_DAYS_AGO = new Date(NOW)
FOURTEEN_DAYS_AGO.setDate(FOURTEEN_DAYS_AGO.getDate() - 14)

function pct(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+inf' : '—'
  const change = ((current - previous) / previous) * 100
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(0)}%`
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

// ─── Section 1: Server Health & Performance ──────────────────────────────────

async function gatherServerHealth(): Promise<string> {
  const lines: string[] = ['## 1. Server Health & Performance', '']

  // Database health check
  const startTime = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1 as health_check`
    const dbMs = Date.now() - startTime
    lines.push(`| Metric | Value |`)
    lines.push(`|--------|-------|`)
    lines.push(`| DB Health | Healthy (${dbMs}ms) |`)
  } catch {
    lines.push(`| DB Health | **UNHEALTHY** |`)
  }

  // Database stats
  const [userCount, taskCount, listCount, commentCount, invitationCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.task.count(),
      prisma.taskList.count(),
      prisma.comment.count(),
      prisma.invitation.count(),
    ])

  // Real (non-AI, non-placeholder) users
  const realUsers = await prisma.user.count({
    where: { isAIAgent: false, isPlaceholder: false },
  })

  lines.push(`| Total Users | ${fmt(userCount)} (${fmt(realUsers)} real) |`)
  lines.push(`| Total Tasks | ${fmt(taskCount)} |`)
  lines.push(`| Total Lists | ${fmt(listCount)} |`)
  lines.push(`| Total Comments | ${fmt(commentCount)} |`)
  lines.push(`| Pending Invitations | ${fmt(invitationCount)} |`)

  // Maintenance cleanup
  const expiredInvitations = await prisma.invitation.updateMany({
    where: { expiresAt: { lt: new Date() }, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  })
  const expiredTokens = await prisma.user.updateMany({
    where: {
      emailTokenExpiresAt: { lt: new Date() },
      emailVerificationToken: { not: null },
    },
    data: { emailVerificationToken: null, emailTokenExpiresAt: null },
  })
  const archivableTasks = await prisma.task.count({
    where: { completed: true, updatedAt: { lt: new Date(Date.now() - 365 * 86400000) } },
  })

  lines.push(`| Expired invitations cleaned | ${expiredInvitations.count} |`)
  lines.push(`| Expired tokens cleaned | ${expiredTokens.count} |`)
  lines.push(`| Archivable tasks (365+ days) | ${archivableTasks} |`)
  lines.push('')

  // Production health endpoint
  try {
    const healthStart = Date.now()
    const res = await fetch('https://astrid.cc/api/health', { signal: AbortSignal.timeout(10000) })
    const healthMs = Date.now() - healthStart
    const data = await res.json()
    lines.push(`**Production /api/health**: ${res.status} ${data.status || ''} (${healthMs}ms)`)
  } catch (e) {
    lines.push(`**Production /api/health**: Failed to reach (${e instanceof Error ? e.message : 'unknown'})`)
  }
  lines.push('')

  // Recent Vercel deployments
  try {
    const token = process.env.VERCEL_TOKEN
    if (token) {
      const output = execSync(
        `npx vercel list --token="${token}" --yes 2>/dev/null | head -20`,
        { encoding: 'utf-8', timeout: 15000 }
      ).trim()
      if (output) {
        lines.push('### Recent Deployments')
        lines.push('```')
        lines.push(output)
        lines.push('```')
      }
    } else {
      lines.push('*Vercel deployments: VERCEL_TOKEN not set, skipping*')
    }
  } catch {
    lines.push('*Vercel deployments: Could not fetch (CLI not available or auth failed)*')
  }

  return lines.join('\n')
}

// ─── Section 2: Usage Analytics ──────────────────────────────────────────────

async function gatherUsageAnalytics(): Promise<string> {
  const lines: string[] = ['## 2. Usage Analytics', '']

  const thisWeek = await prisma.analyticsDailyStats.findMany({
    where: { date: { gte: SEVEN_DAYS_AGO, lte: NOW } },
    orderBy: { date: 'asc' },
  })

  const lastWeek = await prisma.analyticsDailyStats.findMany({
    where: { date: { gte: FOURTEEN_DAYS_AGO, lt: SEVEN_DAYS_AGO } },
    orderBy: { date: 'asc' },
  })

  if (thisWeek.length === 0) {
    lines.push('*No analytics data for this period. Is the analytics cron running?*')
    return lines.join('\n')
  }

  // Compute averages and sums
  const sum = (arr: typeof thisWeek, key: keyof (typeof thisWeek)[0]) =>
    arr.reduce((s, row) => s + (Number(row[key]) || 0), 0)
  const avg = (arr: typeof thisWeek, key: keyof (typeof thisWeek)[0]) =>
    arr.length ? sum(arr, key) / arr.length : 0

  const avgDauThis = avg(thisWeek, 'dau')
  const avgDauLast = avg(lastWeek, 'dau')
  const latestRow = thisWeek[thisWeek.length - 1]
  const lastWeekLatest = lastWeek.length ? lastWeek[lastWeek.length - 1] : null

  // New signups
  const signupsThis = await prisma.user.count({
    where: { createdAt: { gte: SEVEN_DAYS_AGO }, isAIAgent: false, isPlaceholder: false },
  })
  const signupsLast = await prisma.user.count({
    where: {
      createdAt: { gte: FOURTEEN_DAYS_AGO, lt: SEVEN_DAYS_AGO },
      isAIAgent: false,
      isPlaceholder: false,
    },
  })

  const dateRange = `${SEVEN_DAYS_AGO.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${NOW.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  lines.push(`*Period: ${dateRange}*`)
  lines.push('')

  lines.push('| Metric | This Week | Last Week | Change |')
  lines.push('|--------|-----------|-----------|--------|')
  lines.push(`| Avg DAU | ${avgDauThis.toFixed(1)} | ${avgDauLast.toFixed(1)} | ${pct(avgDauThis, avgDauLast)} |`)
  lines.push(`| WAU (latest) | ${latestRow?.wau ?? '—'} | ${lastWeekLatest?.wau ?? '—'} | ${latestRow && lastWeekLatest ? pct(latestRow.wau, lastWeekLatest.wau) : '—'} |`)
  lines.push(`| MAU (latest) | ${latestRow?.mau ?? '—'} | ${lastWeekLatest?.mau ?? '—'} | ${latestRow && lastWeekLatest ? pct(latestRow.mau, lastWeekLatest.mau) : '—'} |`)

  const stickiness = latestRow && latestRow.mau > 0 ? (latestRow.dau / latestRow.mau).toFixed(2) : '—'
  lines.push(`| Stickiness (DAU/MAU) | ${stickiness} | — | — |`)
  lines.push(`| New Signups | ${signupsThis} | ${signupsLast} | ${pct(signupsThis, signupsLast)} |`)
  lines.push('')

  // Event totals
  const events = {
    'Tasks created': [sum(thisWeek, 'taskCreated'), sum(lastWeek, 'taskCreated')],
    'Tasks completed': [sum(thisWeek, 'taskCompleted'), sum(lastWeek, 'taskCompleted')],
    'Tasks edited': [sum(thisWeek, 'taskEdited'), sum(lastWeek, 'taskEdited')],
    'Comments added': [sum(thisWeek, 'commentAdded'), sum(lastWeek, 'commentAdded')],
    'Lists created': [sum(thisWeek, 'listAdded'), sum(lastWeek, 'listAdded')],
    'Settings updated': [sum(thisWeek, 'settingsUpdated'), sum(lastWeek, 'settingsUpdated')],
  }

  lines.push('### Event Totals')
  lines.push('| Event | This Week | Last Week | Change |')
  lines.push('|-------|-----------|-----------|--------|')
  for (const [label, [tw, lw]] of Object.entries(events)) {
    lines.push(`| ${label} | ${fmt(tw)} | ${fmt(lw)} | ${pct(tw, lw)} |`)
  }
  lines.push('')

  // Platform breakdown
  const platforms = {
    Desktop: sum(thisWeek, 'dauWebDesktop'),
    iPhone: sum(thisWeek, 'dauWebIPhone'),
    Android: sum(thisWeek, 'dauWebAndroid'),
    'iOS App': sum(thisWeek, 'dauIOSApp'),
    API: sum(thisWeek, 'dauAPIOther'),
  }
  const platformTotal = Object.values(platforms).reduce((a, b) => a + b, 0) || 1
  const platformStr = Object.entries(platforms)
    .map(([k, v]) => `${k}: ${((v / platformTotal) * 100).toFixed(0)}%`)
    .join('  |  ')
  lines.push(`### Platform Breakdown (DAU sum)`)
  lines.push(platformStr)

  return lines.join('\n')
}

// ─── Section 3: Error & Performance Signals ──────────────────────────────────

async function gatherErrorSignals(): Promise<string> {
  const lines: string[] = ['## 3. Error & Performance Signals', '']

  // Check for zero-DAU days (outage indicator)
  const thisWeek = await prisma.analyticsDailyStats.findMany({
    where: { date: { gte: SEVEN_DAYS_AGO, lte: NOW } },
    orderBy: { date: 'asc' },
  })

  const zeroDays = thisWeek.filter((d) => d.dau === 0)
  if (zeroDays.length > 0) {
    lines.push(`**WARNING: ${zeroDays.length} day(s) with zero DAU (possible outage)**`)
    for (const d of zeroDays) {
      lines.push(`- ${d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`)
    }
  } else {
    lines.push(`No zero-DAU days this week (good)`)
  }
  lines.push('')

  // Event distribution (check for anomalies)
  const eventsByType = await prisma.analyticsEvent.groupBy({
    by: ['eventType'],
    where: { createdAt: { gte: SEVEN_DAYS_AGO } },
    _count: { eventType: true },
    orderBy: { _count: { eventType: 'desc' } },
  })

  if (eventsByType.length > 0) {
    const totalEvents = eventsByType.reduce((s, e) => s + e._count.eventType, 0)
    lines.push('### Event Distribution')
    lines.push('| Event Type | Count | % |')
    lines.push('|------------|-------|---|')
    for (const e of eventsByType.slice(0, 15)) {
      const p = ((e._count.eventType / totalEvents) * 100).toFixed(1)
      lines.push(`| ${e.eventType} | ${fmt(e._count.eventType)} | ${p}% |`)
    }
    lines.push(`| **Total** | **${fmt(totalEvents)}** | |`)
  }

  return lines.join('\n')
}

// ─── Section 4: Public Lists & User Engagement ──────────────────────────────

async function gatherPublicListsEngagement(): Promise<string> {
  const lines: string[] = ['## 4. Public Lists & User Engagement', '']

  // Top public lists by popularity
  const publicLists = await prisma.taskList.findMany({
    where: { privacy: 'PUBLIC', isVirtual: false },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: { copyCount: 'desc' },
    take: 10,
  })

  const totalPublicLists = await prisma.taskList.count({
    where: { privacy: 'PUBLIC', isVirtual: false },
  })

  const newPublicLists = await prisma.taskList.count({
    where: { privacy: 'PUBLIC', isVirtual: false, createdAt: { gte: SEVEN_DAYS_AGO } },
  })

  const totalCopies = publicLists.reduce((s, l) => s + l.copyCount, 0)

  lines.push(`Total public lists: ${totalPublicLists} | New this week: ${newPublicLists} | Total copies (top 10): ${totalCopies}`)
  lines.push('')

  if (publicLists.length > 0) {
    lines.push('### Top Public Lists')
    lines.push('| List | Owner | Tasks | Copies |')
    lines.push('|------|-------|-------|--------|')
    for (const l of publicLists) {
      lines.push(`| ${l.name} | ${l.owner.name || 'Unknown'} | ${l._count.tasks} | ${l.copyCount} |`)
    }
    lines.push('')
  }

  // Recent comments
  const recentComments = await prisma.comment.findMany({
    where: { createdAt: { gte: SEVEN_DAYS_AGO } },
    include: {
      author: { select: { name: true, isAIAgent: true } },
      task: { select: { title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const humanComments = recentComments.filter((c) => !c.author?.isAIAgent)
  const aiComments = recentComments.length - humanComments.length

  lines.push(`### Comments This Week`)
  lines.push(`Total: ${recentComments.length} (${humanComments.length} human, ${aiComments} AI)`)
  lines.push('')

  if (humanComments.length > 0) {
    lines.push('Recent human comments:')
    for (const c of humanComments.slice(0, 10)) {
      const preview = c.content.slice(0, 80).replace(/\n/g, ' ')
      lines.push(`- **${c.author?.name || 'User'}** on "${c.task?.title || 'Unknown'}": ${preview}`)
    }
    lines.push('')
  }

  // Top users by engagement
  const topUsers = await prisma.user.findMany({
    where: { isAIAgent: false, isPlaceholder: false },
    orderBy: { statsCompletedTasks: 'desc' },
    select: {
      name: true,
      statsCompletedTasks: true,
      statsInspiredTasks: true,
      statsSupportedTasks: true,
    },
    take: 5,
  })

  if (topUsers.length > 0) {
    lines.push('### Top Users (all time)')
    lines.push('| User | Completed | Inspired | Supported |')
    lines.push('|------|-----------|----------|-----------|')
    for (const u of topUsers) {
      lines.push(`| ${u.name || 'Unknown'} | ${u.statsCompletedTasks} | ${u.statsInspiredTasks} | ${u.statsSupportedTasks} |`)
    }
  }

  return lines.join('\n')
}

// ─── Section 5: Code Health ──────────────────────────────────────────────────

function gatherCodeHealth(): string {
  const lines: string[] = ['## 5. Code Health', '']
  const root = process.cwd()

  // Scripts analysis
  const scriptsDir = path.join(root, 'scripts')
  const allScripts = readdirSync(scriptsDir).filter(
    (f) => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.sh')
  )

  let pkgContent: string
  try {
    pkgContent = readFileSync(path.join(root, 'package.json'), 'utf-8')
  } catch {
    pkgContent = ''
  }

  const referencedScripts = allScripts.filter((s) => pkgContent.includes(`scripts/${s}`))
  const orphanedScripts = allScripts.filter((s) => !pkgContent.includes(`scripts/${s}`))

  // Group orphans by prefix
  const orphanGroups: Record<string, string[]> = {}
  for (const s of orphanedScripts) {
    const prefix = s.replace(/[-_].*$/, '').replace(/\..+$/, '')
    if (!orphanGroups[prefix]) orphanGroups[prefix] = []
    orphanGroups[prefix].push(s)
  }

  // TODO/FIXME/HACK count
  let todoCount = 0
  try {
    const result = execSync(
      `grep -r "TODO\\|FIXME\\|HACK" --include="*.ts" --include="*.tsx" -c ${root}/app ${root}/lib ${root}/components 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 10000 }
    )
    todoCount = result
      .trim()
      .split('\n')
      .filter(Boolean)
      .reduce((sum, line) => {
        const count = parseInt(line.split(':').pop() || '0', 10)
        return sum + (isNaN(count) ? 0 : count)
      }, 0)
  } catch {
    todoCount = -1
  }

  // Check for unused deps (in package.json but not imported in app code)
  const unusedDeps: string[] = []
  const pkg = JSON.parse(pkgContent || '{}')
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  const suspectDeps = ['geist', 'embla-carousel-react', 'canvas']
  for (const dep of suspectDeps) {
    if (!allDeps[dep]) continue // not installed, skip
    try {
      const result = execSync(
        `grep -r "${dep}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" ${root}/app ${root}/lib ${root}/components 2>/dev/null | head -1`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim()
      if (!result) unusedDeps.push(dep)
    } catch {
      unusedDeps.push(dep)
    }
  }

  // Legacy files
  const legacyFiles: string[] = []
  if (existsSync(path.join(root, 'pages', '_error.tsx'))) {
    legacyFiles.push('pages/_error.tsx (Pages Router — App Router handles errors)')
  }

  lines.push('| Metric | Count | Status |')
  lines.push('|--------|-------|--------|')
  lines.push(`| Total scripts | ${allScripts.length} | — |`)
  lines.push(`| Referenced in package.json | ${referencedScripts.length} | — |`)
  lines.push(`| Orphaned scripts | ${orphanedScripts.length} | ${orphanedScripts.length > 50 ? 'Needs cleanup' : 'OK'} |`)
  lines.push(`| Unused npm deps | ${unusedDeps.length} | ${unusedDeps.length > 0 ? unusedDeps.join(', ') : 'None'} |`)
  lines.push(`| Legacy files | ${legacyFiles.length} | ${legacyFiles.length > 0 ? legacyFiles.join('; ') : 'None'} |`)
  lines.push(`| TODO/FIXME/HACK | ${todoCount >= 0 ? todoCount : '?'} | ${todoCount > 30 ? 'Review' : 'OK'} |`)
  lines.push('')

  if (orphanedScripts.length > 0) {
    lines.push('### Orphaned Scripts by Prefix')
    const sorted = Object.entries(orphanGroups).sort((a, b) => b[1].length - a[1].length)
    for (const [prefix, scripts] of sorted.slice(0, 10)) {
      lines.push(`- **${prefix}-*** (${scripts.length}): ${scripts.slice(0, 3).join(', ')}${scripts.length > 3 ? `, +${scripts.length - 3} more` : ''}`)
    }
  }

  return lines.join('\n')
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.error('Generating weekly product review...\n')

  const sections = await Promise.all([
    gatherServerHealth(),
    gatherUsageAnalytics(),
    gatherErrorSignals(),
    gatherPublicListsEngagement(),
  ])

  const codeHealth = gatherCodeHealth()

  const report = [
    `# Weekly Product Review — ${NOW.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    `*Generated: ${NOW.toISOString()}*`,
    '',
    ...sections,
    '',
    codeHealth,
    '',
    '---',
    '*Generated by `npm run weekly-review`*',
  ].join('\n\n')

  console.log(report)

  if (process.argv.includes('--save')) {
    const dir = path.join(process.cwd(), 'logs', 'weekly-review')
    mkdirSync(dir, { recursive: true })
    const filename = `review-${NOW.toISOString().split('T')[0]}.md`
    const filepath = path.join(dir, filename)
    writeFileSync(filepath, report)
    console.error(`\nSaved to logs/weekly-review/${filename}`)
  }
}

main()
  .catch((err) => {
    console.error('Weekly review failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
