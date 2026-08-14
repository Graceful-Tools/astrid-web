import { NextRequest, NextResponse } from "next/server"
import { parseLimit } from "@/lib/pagination"
import { getUnifiedSession } from "@/lib/session-utils"
import { getPopularPublicLists, searchPublicLists, getRecentPublicLists } from "@/lib/copy-utils"
import { RedisCache } from "@/lib/redis"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.public')


export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get("q")
    // Capped and NaN-safe. Was parseInt with no ceiling, so ?limit=1000000
    // became take: 1000000 on a public listing endpoint. Default stays 10:
    // four web callers rely on this page size. (Task e0613ae5.)
    const limit = parseLimit(searchParams.get("limit"), { fallback: 10, max: 100 })
    const sortBy = searchParams.get("sortBy") || "popular"
    const ownerId = searchParams.get("ownerId")

    // Generate cache key based on query parameters
    const cacheKey = `public_lists:${sortBy}:${limit}:${query || 'none'}:${ownerId || 'all'}`

    let publicLists

    if (query) {
      // Search public lists - cache for 2 minutes (searches change less frequently)
      log.info(`🔍 Searching public lists for: "${query}"`)
      publicLists = await RedisCache.getOrSet(
        cacheKey,
        () => searchPublicLists(query, limit, { sortBy, ownerId }),
        120 // 2 minutes
      )
    } else if (sortBy === "recent") {
      // Get recent public lists - cache for 1 minute (recent lists change frequently)
      log.info(`📋 Fetching ${limit} recent public lists`)
      publicLists = await RedisCache.getOrSet(
        cacheKey,
        () => getRecentPublicLists(limit, { ownerId }),
        60 // 1 minute
      )
    } else {
      // Get popular public lists - cache for 5 minutes (popular lists change slowly)
      log.info(`📋 Fetching ${limit} popular public lists`)
      publicLists = await RedisCache.getOrSet(
        cacheKey,
        () => getPopularPublicLists(limit, { ownerId }),
        300 // 5 minutes
      )
    }

    return NextResponse.json({
      success: true,
      lists: publicLists,
      count: publicLists.length
    })

  } catch (error) {
    log.error({ err: error }, "Error fetching public lists:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}