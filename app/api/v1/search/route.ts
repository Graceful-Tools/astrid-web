/**
 * Server-side search (task 5df85b9f).
 *
 * GET /api/v1/search?q=…&limit=…&cursor=…
 *
 * Search was client-side substring matching over already-loaded tasks. That
 * works at a few hundred tasks and quietly breaks at a few thousand — results
 * silently omit anything not yet fetched, which is worse than failing.
 *
 * **Permission filtering happens in the query, never post-hoc**, and reuses the
 * same visible-list resolution as the rest of the product (listVisibilityWhere,
 * which inherits project membership from task 6c20d125). Filtering after the
 * fact would mean the database had already handed us rows the caller may not
 * see, and one forgotten filter becomes a leak.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { listVisibilityWhere } from '@/lib/list-permissions'
import {
  parseSearchQuery,
  isEmptySearch,
  priorityToNumber,
  toTextSearchTerms,
} from '@/lib/search-query-parser'

const log = createLogger('v1.search')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.search' },
  async (req, auth) => {
    const url = new URL(req.url)
    const rawQuery = url.searchParams.get('q') || ''
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    )
    const offset = Math.max(parseInt(url.searchParams.get('cursor') || '0', 10) || 0, 0)

    const parsed = parseSearchQuery(rawQuery)

    // An empty query returns nothing rather than every task the caller can see:
    // "no query" is not "show me everything".
    if (isEmptySearch(parsed)) {
      return NextResponse.json({ query: parsed, tasks: [], lists: [], total: 0, nextCursor: null })
    }

    // The visibility floor. Every branch below narrows this; nothing widens it.
    const visibleListWhere = listVisibilityWhere(auth.userId, { includePublic: true })
    const visibility = {
      OR: [
        { creatorId: auth.userId },
        { assigneeId: auth.userId },
        { lists: { some: visibleListWhere } },
      ],
    }

    const filters: Record<string, unknown>[] = [visibility]

    // A bare identifier is a direct hit — still inside the visibility floor.
    if (parsed.identifier) {
      filters.push({ identifier: parsed.identifier })
    }

    if (parsed.text) {
      const terms = toTextSearchTerms(parsed.text)
      if (terms) {
        // `contains` on title/description plus comment content. Deliberately
        // simple: swapping in a tsvector column is a migration, and this
        // endpoint's contract (permission-filtered, paginated, structured
        // filters) is the part that had to land first.
        filters.push({
          OR: [
            { title: { contains: terms, mode: 'insensitive' } },
            { description: { contains: terms, mode: 'insensitive' } },
            { comments: { some: { content: { contains: terms, mode: 'insensitive' } } } },
          ],
        })
      }
    }

    if (parsed.assignee) {
      filters.push(
        parsed.assignee === 'me'
          ? { assigneeId: auth.userId }
          : { assignee: { email: { equals: parsed.assignee, mode: 'insensitive' } } }
      )
    }

    for (const name of parsed.listNames) {
      filters.push({ lists: { some: { name: { equals: name, mode: 'insensitive' }, listType: { not: 'label' } } } })
    }

    for (const name of parsed.labelNames) {
      filters.push({ lists: { some: { name: { equals: name, mode: 'insensitive' }, listType: 'label' } } })
    }

    if (parsed.priorities.length > 0) {
      filters.push({ priority: { in: parsed.priorities.map(priorityToNumber) } })
    }

    if (parsed.statuses.length > 0) {
      // 'none' is Inbox — the absence of a status, which is a null column
      // rather than a value, so it cannot go in the same `in` clause.
      const wantsInbox = parsed.statuses.includes('none')
      const roles = parsed.statuses.filter(status => status !== 'none')
      const clauses: Record<string, unknown>[] = []
      if (roles.length > 0) clauses.push({ statusRole: { in: roles } })
      if (wantsInbox) clauses.push({ statusRole: null })
      filters.push(clauses.length === 1 ? clauses[0] : { OR: clauses })
    }

    if (parsed.state === 'open') filters.push({ completed: false })
    if (parsed.state === 'done') filters.push({ completed: true, closedReason: null })
    if (parsed.state === 'canceled') filters.push({ completed: true, closedReason: { not: null } })

    if (parsed.due) {
      const now = new Date()
      const startOfToday = new Date(now)
      startOfToday.setHours(0, 0, 0, 0)
      const endOfToday = new Date(startOfToday)
      endOfToday.setDate(endOfToday.getDate() + 1)

      if (parsed.due === 'today') {
        filters.push({ dueDateTime: { gte: startOfToday, lt: endOfToday } })
      } else if (parsed.due === 'overdue') {
        filters.push({ dueDateTime: { lt: startOfToday }, completed: false })
      } else if (parsed.due === 'week') {
        const end = new Date(startOfToday)
        end.setDate(end.getDate() + 7)
        filters.push({ dueDateTime: { gte: startOfToday, lt: end } })
      } else if (parsed.due === 'month') {
        const end = new Date(startOfToday)
        end.setMonth(end.getMonth() + 1)
        filters.push({ dueDateTime: { gte: startOfToday, lt: end } })
      } else if (parsed.due === 'none') {
        filters.push({ dueDateTime: null })
      }
    }

    const where = { AND: filters }

    try {
      const [tasks, total, lists] = await Promise.all([
        prisma.task.findMany({
          where: where as never,
          select: {
            id: true,
            identifier: true,
            title: true,
            description: true,
            completed: true,
            closedReason: true,
            priority: true,
            dueDateTime: true,
            updatedAt: true,
            assignee: { select: { id: true, name: true, email: true, image: true } },
            lists: { select: { id: true, name: true, color: true, listType: true } },
          },
          orderBy: [{ completed: 'asc' }, { updatedAt: 'desc' }],
          take: limit,
          skip: offset,
        }),
        prisma.task.count({ where: where as never }),
        // Lists matching by name, so the palette can offer "jump to list".
        parsed.text
          ? prisma.taskList.findMany({
              where: {
                AND: [
                  visibleListWhere as never,
                  { name: { contains: parsed.text, mode: 'insensitive' } },
                ],
              },
              select: { id: true, name: true, color: true, listType: true },
              take: 10,
            })
          : Promise.resolve([]),
      ])

      const nextCursor = offset + tasks.length < total ? String(offset + tasks.length) : null

      return NextResponse.json({
        query: parsed,
        tasks,
        lists,
        total,
        nextCursor,
        meta: { apiVersion: 'v1', authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error, q: rawQuery }, 'Search failed')
      return NextResponse.json({ error: 'Search failed' }, { status: 500 })
    }
  }
)
