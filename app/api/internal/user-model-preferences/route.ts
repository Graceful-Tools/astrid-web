import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { DEFAULT_MODELS, type AIService } from "@/lib/ai/agent-config"
import { MCPSettingsSchema, parseUserAIConfig } from "@/lib/ai/user-config-schemas"

const RequestSchema = z.object({
  userId: z.string(),
  service: z.enum(['claude', 'openai', 'gemini'])
})

/**
 * Internal API for fetching user's model preference
 * Used by the AI agent worker to get user preferences
 *
 * POST /api/internal/user-model-preferences
 * Body: { userId: string, service: 'claude' | 'openai' | 'gemini' }
 *
 * Security: Requires X-Internal-Secret header matching INTERNAL_API_SECRET env var
 */
export async function POST(request: NextRequest) {
  try {
    // Verify internal secret
    const internalSecret = request.headers.get('X-Internal-Secret')
    const expectedSecret = process.env.INTERNAL_API_SECRET

    // Require secret to be configured and matching
    if (!expectedSecret || internalSecret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = RequestSchema.parse(data)

    const user = await prisma.user.findUnique({
      where: { id: validatedData.userId },
      select: { mcpSettings: true }
    })

    if (!user) {
      return NextResponse.json({
        model: DEFAULT_MODELS[validatedData.service as AIService],
        isDefault: true
      })
    }

    const mcpSettings = parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, 'internal/user-model-preferences')
    const modelPreferences = mcpSettings.modelPreferences || {}
    const userModel = modelPreferences[validatedData.service]

    if (userModel) {
      return NextResponse.json({
        model: userModel,
        isDefault: false
      })
    }

    return NextResponse.json({
      model: DEFAULT_MODELS[validatedData.service as AIService],
      isDefault: true
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
        { status: 400 }
      )
    }

    console.error("Error fetching user model preference:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
