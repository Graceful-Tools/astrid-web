/**
 * GET /api/v1/users/search
 *
 * Type-ahead user search scoped by list/task context. Mirrors
 * /api/users/search behavior, including AI-agent inclusion when the
 * user has API keys configured for them.
 *
 * Query params:
 *   q          — search term (min 2 chars unless taskId/listIds/includeAIAgents set)
 *   taskId     — limit to users with access to the lists this task belongs to
 *   listIds    — comma-separated list IDs to scope by
 *   includeAIAgents — include AI agents the user has API keys for (My Tasks flow)
 */

import { openClawEmailSuffix } from '@/lib/brand/agent-emails'
import { resolveSearchListIds } from '@/lib/user-search-scope'
import { getAssignableAgentEmails, getKeyedAgentEmails } from '@/lib/ai/assignable-agents'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { isCodingAgent } from '@/lib/ai-agent-utils'
import { hasValidApiKey } from '@/lib/api-key-cache'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.search')

interface UserSearchResult {
  id: string
  name: string | null
  email: string
  image: string | null
  isAIAgent?: boolean
  aiAgentType?: string | null
}

// Which agents exist is configuration; see lib/ai/assignable-agents.ts. Task 97208a72.
const AI_AGENT_EMAILS = getAssignableAgentEmails()

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.search' },
  async (req, auth) => {
    try {
      const { searchParams } = new URL(req.url)
      const query = searchParams.get('q')
      const taskId = searchParams.get('taskId')
      const listIds = searchParams.get('listIds')?.split(',').filter(Boolean)
      const includeAIAgents = searchParams.get('includeAIAgents') === 'true'

      const allowEmptyQuery = !!taskId || (listIds?.length ?? 0) > 0 || includeAIAgents
      if (!allowEmptyQuery && (!query || query.length < 2)) {
        return NextResponse.json({
          users: [],
          listMemberCount: 0,
          meta: { apiVersion: 'v1' as const, authSource: auth.source },
        })
      }

      let listMembers: UserSearchResult[] = []

      // Only lists this caller actually belongs to. `listIds` and `taskId`
      // arrive from the query string, and this endpoint returns members'
      // EMAIL ADDRESSES — so taking them at face value let anyone holding a
      // list id enumerate that list's members. (Task e0613ae5.)
      const relevantListIds = await resolveSearchListIds({
        userId: auth.userId,
        listIds,
        taskId,
      })

      if (relevantListIds.length > 0) {
        const listAccessCondition = {
          OR: [
            { ownedLists: { some: { id: { in: relevantListIds } } } },
            { listMemberships: { some: { listId: { in: relevantListIds } } } },
          ],
        }
        const nameSearch = query ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' as const } },
            { email: { contains: query, mode: 'insensitive' as const } },
          ],
        } : {}
        const where = query
          ? { AND: [listAccessCondition, nameSearch] }
          : listAccessCondition
        listMembers = await prisma.user.findMany({
          where,
          select: { id: true, name: true, email: true, image: true },
          take: 10,
        })
      }

      let aiAgents: UserSearchResult[] = []
      if (relevantListIds.length > 0) {
        const conds: object[] = []
        if (query && query.length >= 2) {
          conds.push({
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } },
            ],
          })
        } else if (allowEmptyQuery) {
          conds.push({})
        }
        if (conds.length > 0) {
          aiAgents = await prisma.user.findMany({
            where: {
              AND: [
                { isAIAgent: true }, { isActive: true },
                {
                  OR: [
                    { email: { in: AI_AGENT_EMAILS } },
                    { email: { endsWith: openClawEmailSuffix() } },
                  ],
                },
                { listMemberships: { some: { listId: { in: relevantListIds } } } },
                ...conds,
              ],
            },
            select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true },
            take: 5,
          })
        }
      }

      if (includeAIAgents && aiAgents.length === 0) {
        const availableEmails = await getKeyedAgentEmails(auth.userId)

        if (availableEmails.length > 0) {
          const conds: object[] = []
          if (query && query.length >= 2) {
            conds.push({
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { email: { contains: query, mode: 'insensitive' as const } },
              ],
            })
          }
          aiAgents = await prisma.user.findMany({
            where: {
              AND: [
                { isAIAgent: true }, { isActive: true },
                {
                  OR: [
                    { email: { in: availableEmails } },
                    { email: { endsWith: openClawEmailSuffix() } },
                  ],
                },
                ...conds,
              ],
            },
            select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true },
            take: 5,
          })
        }
      }

      const currentUser = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, name: true, email: true, image: true },
      })

      const allUsers: UserSearchResult[] = []
      const seen = new Set<string>()
      for (const a of aiAgents) {
        if (!seen.has(a.id)) { seen.add(a.id); allUsers.push(a) }
      }
      for (const m of listMembers) {
        if (!seen.has(m.id)) { seen.add(m.id); allUsers.push(m) }
      }
      if (currentUser && !seen.has(currentUser.id)) {
        seen.add(currentUser.id); allUsers.push(currentUser)
      }

      const usersWithMetadata = allUsers.slice(0, 10).map(user => {
        const isListMember = listMembers.some(m => m.id === user.id)
        const isAnyAIAgent = !!user.isAIAgent
        return {
          ...user,
          isListMember: isListMember || isAnyAIAgent,
          isCodingAgent: isCodingAgent(user),
        }
      })

      return NextResponse.json({
        users: usersWithMetadata,
        listMemberCount: listMembers.length,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error searching users')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
