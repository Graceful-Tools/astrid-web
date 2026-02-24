import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { DEFAULT_MODELS, SUGGESTED_MODELS, type AIService } from "@/lib/ai/agent-config"

const UpdateModelSchema = z.object({
  serviceId: z.enum(['claude', 'openai', 'gemini', 'openclaw']),
  model: z.string().min(1).max(100)
})

const ResetModelSchema = z.object({
  serviceId: z.enum(['claude', 'openai', 'gemini', 'openclaw'])
})

/**
 * GET /api/user/ai-model-preferences
 * Returns user's model preferences with defaults and suggestions
 */
export async function GET() {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpSettings: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const mcpSettings = user.mcpSettings ? JSON.parse(user.mcpSettings) : {}
    const modelPreferences = mcpSettings.modelPreferences || {}

    // Return preferences with defaults for any missing services
    const preferences: Record<AIService, { model: string; isDefault: boolean }> = {
      claude: {
        model: modelPreferences.claude || DEFAULT_MODELS.claude,
        isDefault: !modelPreferences.claude
      },
      openai: {
        model: modelPreferences.openai || DEFAULT_MODELS.openai,
        isDefault: !modelPreferences.openai
      },
      gemini: {
        model: modelPreferences.gemini || DEFAULT_MODELS.gemini,
        isDefault: !modelPreferences.gemini
      },
      openclaw: {
        model: modelPreferences.openclaw || DEFAULT_MODELS.openclaw,
        isDefault: !modelPreferences.openclaw
      }
    }

    return NextResponse.json({
      preferences,
      defaults: DEFAULT_MODELS,
      suggestions: SUGGESTED_MODELS
    })
  } catch (error) {
    console.error("Error fetching model preferences:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * PUT /api/user/ai-model-preferences
 * Update model preference for a specific service
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = UpdateModelSchema.parse(data)

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpSettings: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const mcpSettings = user.mcpSettings ? JSON.parse(user.mcpSettings) : {}
    const modelPreferences = mcpSettings.modelPreferences || {}

    // Update the model preference
    modelPreferences[validatedData.serviceId] = validatedData.model

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        mcpSettings: JSON.stringify({
          ...mcpSettings,
          modelPreferences
        })
      }
    })

    return NextResponse.json({
      success: true,
      model: validatedData.model,
      isDefault: false
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
        { status: 400 }
      )
    }

    console.error("Error updating model preference:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * DELETE /api/user/ai-model-preferences
 * Reset model preference to default for a specific service
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = ResetModelSchema.parse(data)

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpSettings: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const mcpSettings = user.mcpSettings ? JSON.parse(user.mcpSettings) : {}
    const modelPreferences = mcpSettings.modelPreferences || {}

    // Remove the preference to revert to default
    delete modelPreferences[validatedData.serviceId]

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        mcpSettings: JSON.stringify({
          ...mcpSettings,
          modelPreferences
        })
      }
    })

    const defaultModel = DEFAULT_MODELS[validatedData.serviceId as AIService]

    return NextResponse.json({
      success: true,
      model: defaultModel,
      isDefault: true
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
        { status: 400 }
      )
    }

    console.error("Error resetting model preference:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
