import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { RedisCache } from "@/lib/redis"
import { createLogger } from "@/lib/logger"
import { createProjectForUser, listProjectsForUser } from "@/lib/projects-service"
import { requireProjectsBeta } from "@/lib/feature-flags"

const log = createLogger("api.projects")

export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const projects = await listProjectsForUser(session.user.id)
    return NextResponse.json({ projects })
  } catch (error) {
    log.error({ err: error }, "Error fetching projects:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Projects is an opt-in Beta — only enrolled users can create boards.
    if (!(await requireProjectsBeta(session.user.id))) {
      return NextResponse.json({ error: "Projects is in beta. Enable it in Settings to create boards." }, { status: 403 })
    }

    const data = await request.json()
    const name = typeof data.name === "string" ? data.name.trim() : ""

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    const project = await createProjectForUser(session.user.id, {
      name,
      description: data.description,
      color: data.color,
      imageUrl: data.imageUrl,
    })

    await RedisCache.del(RedisCache.keys.userLists(session.user.id)).catch((error) => {
      log.error({ err: error }, "Failed to invalidate list cache after project creation:")
    })

    return NextResponse.json(project)
  } catch (error) {
    log.error({ err: error }, "Error creating project:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
