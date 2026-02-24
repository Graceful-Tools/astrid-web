import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { isCodingAgent } from "@/lib/ai-agent-utils"
import { hasValidApiKey } from "@/lib/api-key-cache"

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    let session = await getServerSession(authConfig)

    // If JWT session validation failed, try database session (for mobile apps)
    if (!session?.user) {
      const cookieHeader = request.headers.get('cookie')
      if (cookieHeader) {
        // Extract session token from cookie header
        const sessionTokenMatch = cookieHeader.match(/next-auth\.session-token=([^;]+)/)
        if (sessionTokenMatch) {
          const sessionToken = sessionTokenMatch[1]
          // Check database for valid session
          const dbSession = await prisma.session.findUnique({
            where: { sessionToken },
            include: { user: true }
          })

          if (dbSession && dbSession.expires > new Date()) {
            // Create session object matching NextAuth format
            session = {
              user: {
                id: dbSession.user.id,
                email: dbSession.user.email,
                name: dbSession.user.name,
                image: dbSession.user.image,
              },
              expires: dbSession.expires.toISOString()
            }
          }
        }
      }
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get("q")
    const taskId = searchParams.get("taskId")
    const listIds = searchParams.get("listIds")?.split(",").filter(Boolean)
    // Include AI agents based on user's configured API keys (for My Tasks, etc.)
    const includeAIAgents = searchParams.get("includeAIAgents") === "true"

    // Allow empty queries when taskId, listIds, or includeAIAgents are provided
    // This enables showing list members OR AI agents based on user's API keys
    const allowEmptyQuery = taskId || (listIds && listIds.length > 0) || includeAIAgents
    if (!allowEmptyQuery && (!query || query.length < 2)) {
      return NextResponse.json({ users: [] })
    }

    let listMembers: any[] = []
    let relevantListIds: string[] = []

    // If taskId or listIds provided, get all members from associated lists
    if (taskId || (listIds && listIds.length > 0)) {
      relevantListIds = listIds || []

      // If taskId provided, get the lists associated with this task
      if (taskId) {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: {
            lists: { select: { id: true } }
          }
        })
        console.log("Task found:", task)
        if (task) {
          relevantListIds = task.lists.map(list => list.id)
        }
      }
      
      console.log("Relevant list IDs:", relevantListIds)

      if (relevantListIds.length > 0) {
        // Get all users who have access to these lists (owners, admins, members)
        console.log("About to query users for list IDs:", relevantListIds)
        try {
          const listAccessCondition = {
            OR: [
              // List owners
              { ownedLists: { some: { id: { in: relevantListIds } } } },
              // List members (via listMembers table)
              { listMemberships: { some: { listId: { in: relevantListIds } } } }
            ]
          };

          const nameSearchCondition = query ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } }
            ]
          } : {};

          const whereCondition = query 
            ? { AND: [listAccessCondition, nameSearchCondition] }
            : listAccessCondition;

          listMembers = await prisma.user.findMany({
          where: whereCondition,
          select: {
            id: true,
            name: true,
            email: true,
            image: true
          },
          take: 10
        });
        console.log("Found list members:", listMembers);
        } catch (error) {
          console.error("Error querying list members:", error);
          listMembers = [];
        }
      }
    }


    // Search for AI agents (like coding agent)
    let aiAgents: any[] = []
    const aiAgentEmails = ['claude@astrid.cc', 'openai@astrid.cc', 'gemini@astrid.cc', 'openclaw@astrid.cc']
    // Also match {name}.oc@astrid.cc pattern for OpenClaw agents
    const ocPattern = /^[a-z0-9._-]+\.oc@astrid\.cc$/i

    // Option 1: Include AI agents that are members of the relevant lists
    if (relevantListIds.length > 0) {
      const searchConditions = []

      // Add search conditions for AI agents
      if (query && query.length >= 2) {
        searchConditions.push({
          OR: [
            { name: { contains: query, mode: 'insensitive' as const } },
            { email: { contains: query, mode: 'insensitive' as const } }
          ]
        })
      } else if (allowEmptyQuery) {
        // Include all AI agents when showing list members (no additional search condition)
        searchConditions.push({})
      }

      if (searchConditions.length > 0) {
        aiAgents = await prisma.user.findMany({
          where: {
            AND: [
              { isAIAgent: true },
              { isActive: true },
              {
                OR: [
                  { email: { in: aiAgentEmails } },
                  { email: { endsWith: '.oc@astrid.cc' } },  // Match {name}.oc@astrid.cc OpenClaw agents
                ]
              },
              // Only include AI agents that are members of the relevant lists
              {
                // Check list memberships table
                listMemberships: { some: { listId: { in: relevantListIds } } }
              },
              ...searchConditions
            ]
          },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            isAIAgent: true,
            aiAgentType: true
          },
          take: 5 // Limit AI agents to avoid overwhelming the list
        })
      }
    }

    // Option 2: Include AI agents based on user's configured API keys (for My Tasks, etc.)
    if (includeAIAgents && aiAgents.length === 0) {
      // Check which API keys the user has configured
      const [hasClaude, hasOpenAI, hasGemini, hasOpenClaw] = await Promise.all([
        hasValidApiKey(session.user.id, 'claude'),
        hasValidApiKey(session.user.id, 'openai'),
        hasValidApiKey(session.user.id, 'gemini'),
        hasValidApiKey(session.user.id, 'openclaw')
      ])

      const availableAgentEmails: string[] = []
      if (hasClaude) availableAgentEmails.push('claude@astrid.cc')
      if (hasOpenAI) availableAgentEmails.push('openai@astrid.cc')
      if (hasGemini) availableAgentEmails.push('gemini@astrid.cc')
      if (hasOpenClaw) availableAgentEmails.push('openclaw@astrid.cc')

      if (availableAgentEmails.length > 0) {
        const searchConditions: any[] = []

        if (query && query.length >= 2) {
          searchConditions.push({
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } }
            ]
          })
        }

        aiAgents = await prisma.user.findMany({
          where: {
            AND: [
              { isAIAgent: true },
              { isActive: true },
              {
                OR: [
                  { email: { in: availableAgentEmails } },
                  { email: { endsWith: '.oc@astrid.cc' } },  // Include OpenClaw agents
                ]
              },
              ...searchConditions
            ]
          },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            isAIAgent: true,
            aiAgentType: true
          },
          take: 5
        })

        // AI agents found based on user's API keys
      }
    }

    // Only return list members, AI agents, and current user
    // Do NOT search all users - the quick picker should be restricted to:
    // 1. Current user
    // 2. AI agents (if user has configured them)
    // 3. List members (for list context)

    // Always include the current user (for self-assignment)
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true
      }
    })

    // Combine and deduplicate results, prioritizing AI agents, then list members, then current user, then other users
    const allUsers: any[] = []
    const seenIds = new Set<string>()

    // Add AI agents first (coding agents, etc.)
    aiAgents.forEach(agent => {
      if (!seenIds.has(agent.id)) {
        seenIds.add(agent.id)
        allUsers.push({
          id: agent.id,
          name: agent.name,
          email: agent.email,
          image: agent.image,
          isAIAgent: agent.isAIAgent,
          aiAgentType: agent.aiAgentType
        })
      }
    })

    // Add list members (but skip AI agents since they were already added above)
    listMembers.forEach(member => {
      if (!seenIds.has(member.id)) {
        seenIds.add(member.id)
        allUsers.push(member)
      }
    })

    // Add current user if not already included
    if (currentUser && !seenIds.has(currentUser.id)) {
      seenIds.add(currentUser.id)
      allUsers.push(currentUser)
    }

    // Add metadata to indicate which users are list members
    const usersWithMetadata = allUsers.slice(0, 10).map(user => {
      const isListMember = listMembers.some(member => member.id === user.id)
      const isCodingAgentUser = isCodingAgent(user)
      const isAnyAIAgent = !!user.isAIAgent

      return {
        ...user,
        isListMember: isListMember || isAnyAIAgent, // AI agents count as list members when enabled
        isCodingAgent: isCodingAgentUser // Add coding agent flag for UI
      }
    })

    return NextResponse.json({ users: usersWithMetadata, listMemberCount: listMembers.length })
  } catch (error) {
    console.error("Error searching users:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}