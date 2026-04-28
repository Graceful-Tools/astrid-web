import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { createLogger } from '@/lib/logger'

const log = createLogger('user.default-due-time')


const UpdateDefaultDueTimeSchema = z.object({
  defaultDueTime: z.string().nullable()
})

export async function GET() {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { defaultDueTime: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({ defaultDueTime: user.defaultDueTime })
  } catch (error) {
    log.error({ err: error }, "Error fetching user default due time:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { defaultDueTime } = UpdateDefaultDueTimeSchema.parse(body)

    await prisma.user.update({
      where: { email: session.user.email },
      data: { defaultDueTime }
    })

    return NextResponse.json({ success: true, defaultDueTime })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid data", details: error.errors }, { status: 400 })
    }
    
    log.error({ err: error }, "Error updating user default due time:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}