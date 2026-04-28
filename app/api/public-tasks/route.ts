import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { RATE_LIMITS, createRateLimitHeaders } from "@/lib/rate-limiter"
import { createLogger } from '@/lib/logger'

const log = createLogger('public-tasks')


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Apply rate limiting to prevent scraping
  const rateLimit = RATE_LIMITS.PUBLIC.checkRateLimit(request)

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      {
        status: 429,
        headers: {
          ...createRateLimitHeaders(rateLimit),
          'Retry-After': Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString()
        }
      }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const take = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200)
    const skip = parseInt(searchParams.get('offset') || '0', 10)

    const publicTasks = await prisma.task.findMany({
      where: {
        isPrivate: false,
        lists: {
          some: {
            privacy: "PUBLIC",
          },
        },
      },
      include: {
        assignee: true,
        creator: true,
        lists: {
          where: {
            privacy: "PUBLIC",
          },
          include: {
            owner: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take,
      skip,
    })

    return NextResponse.json(publicTasks, {
      headers: createRateLimitHeaders(rateLimit)
    })
  } catch (error) {
    log.error({ err: error }, "Error fetching public tasks:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
