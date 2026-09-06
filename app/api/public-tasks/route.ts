import { NextRequest, NextResponse } from "next/server"
import { publicUserSelect } from '@/lib/user-select'
import { parseLimit, parseOffset } from '@/lib/pagination'
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
    // Math.min(NaN, 200) is NaN, which reached Prisma's take and 500'd.
    // parseLimit already handles that everywhere else (task 49dcf609).
    const take = parseLimit(searchParams.get('limit'), { fallback: 100, max: 200 })
    const skip = parseOffset(searchParams.get('offset'))

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
        assignee: { select: publicUserSelect },
        creator: { select: publicUserSelect },
        lists: {
          where: {
            privacy: "PUBLIC",
          },
          include: {
            owner: { select: publicUserSelect },
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
