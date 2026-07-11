import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { encryptCredential, decryptCredential } from "@/lib/ai/credential-cipher"
import { MCPSettingsSchema, parseUserAIConfig } from "@/lib/ai/user-config-schemas"
import { createLogger } from '@/lib/logger'

const log = createLogger('user.ai-api-keys')


const SaveAPIKeySchema = z.object({
  serviceId: z.enum(['claude', 'openai', 'gemini', 'copilot', 'openclaw']),
  apiKey: z.string().min(1).optional(),
  gatewayUrl: z.string().min(1).optional(),
  authToken: z.string().optional(),
}).refine(
  (data) => {
    if (data.serviceId === 'openclaw') return !!data.gatewayUrl
    return !!data.apiKey
  },
  { message: 'OpenClaw requires gatewayUrl, other services require apiKey' }
)

const DeleteAPIKeySchema = z.object({
  serviceId: z.enum(['claude', 'openai', 'gemini', 'copilot', 'openclaw'])
})

function getKeyPreview(key: string): string {
  if (key.length <= 8) return '***'
  return key.substring(0, 4) + '***' + key.substring(key.length - 4)
}

export async function GET(request: NextRequest) {
  try {
    let session = await getUnifiedSession()

    // If JWT session validation failed, try database session (for mobile apps)
    if (!session?.user) {
      const cookieHeader = request.headers.get('cookie')
      if (cookieHeader) {
        const sessionTokenMatch = cookieHeader.match(/next-auth\.session-token=([^;]+)/)
        if (sessionTokenMatch) {
          const sessionToken = sessionTokenMatch[1]
          const dbSession = await prisma.session.findUnique({
            where: { sessionToken },
            include: { user: true }
          })
          if (dbSession && dbSession.expires > new Date()) {
            session = {
              user: {
                id: dbSession.user.id,
                email: dbSession.user.email,
                name: dbSession.user.name,
                image: dbSession.user.image,
              },
            }
          }
        }
      }
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user's AI API keys from mcpSettings JSON field
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpSettings: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const mcpSettings = parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, 'user/ai-api-keys')
    const apiKeys = mcpSettings.apiKeys || {}

    // Return key status without decrypting the actual keys
    const keyData: any = {}

    for (const [serviceId, keyInfo] of Object.entries(apiKeys)) {
      if (typeof keyInfo === 'object' && keyInfo && 'encrypted' in keyInfo) {
        try {
          const decryptedValue = decryptCredential(keyInfo as any)
          const isGateway = (keyInfo as any).isGateway === true
          keyData[serviceId] = {
            hasKey: true,
            keyPreview: isGateway
              ? (decryptedValue.length > 20 ? decryptedValue.substring(0, 20) + '...' : decryptedValue)
              : getKeyPreview(decryptedValue),
            isValid: (keyInfo as any).isValid,
            lastTested: (keyInfo as any).lastTested,
            error: (keyInfo as any).error
          }
        } catch (error) {
          keyData[serviceId] = {
            hasKey: true,
            keyPreview: '***',
            isValid: false,
            error: 'Failed to decrypt key'
          }
        }
      }
    }

    return NextResponse.json({ keys: keyData })
  } catch (error) {
    log.error({ err: error }, "Error fetching AI API keys:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    let session = await getUnifiedSession()

    // If JWT session validation failed, try database session (for mobile apps)
    if (!session?.user) {
      const cookieHeader = request.headers.get('cookie')
      if (cookieHeader) {
        const sessionTokenMatch = cookieHeader.match(/next-auth\.session-token=([^;]+)/)
        if (sessionTokenMatch) {
          const sessionToken = sessionTokenMatch[1]
          const dbSession = await prisma.session.findUnique({
            where: { sessionToken },
            include: { user: true }
          })
          if (dbSession && dbSession.expires > new Date()) {
            session = {
              user: {
                id: dbSession.user.id,
                email: dbSession.user.email,
                name: dbSession.user.name,
                image: dbSession.user.image,
              },
            }
          }
        }
      }
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = SaveAPIKeySchema.parse(data)

    // Get current settings
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpSettings: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const mcpSettings = parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, 'user/ai-api-keys')
    const apiKeys = mcpSettings.apiKeys || {}

    // Encrypt and store based on service type
    if (validatedData.serviceId === 'openclaw') {
      // Gateway service: encrypt URL and optional auth token
      const encryptedUrl = encryptCredential(validatedData.gatewayUrl!)
      const encryptedToken = validatedData.authToken ? encryptCredential(validatedData.authToken) : null

      apiKeys[validatedData.serviceId] = {
        ...encryptedUrl,
        isGateway: true,
        authToken: encryptedToken,
        isValid: null,
        lastTested: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    } else {
      // Standard API key service
      const encryptedKey = encryptCredential(validatedData.apiKey!)

      apiKeys[validatedData.serviceId] = {
        ...encryptedKey,
        isValid: null, // Will be set when tested
        lastTested: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }

    // Update user settings
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        mcpSettings: JSON.stringify({
          ...mcpSettings,
          apiKeys
        })
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, "Error saving AI API key:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    let session = await getUnifiedSession()

    // If JWT session validation failed, try database session (for mobile apps)
    if (!session?.user) {
      const cookieHeader = request.headers.get('cookie')
      if (cookieHeader) {
        const sessionTokenMatch = cookieHeader.match(/next-auth\.session-token=([^;]+)/)
        if (sessionTokenMatch) {
          const sessionToken = sessionTokenMatch[1]
          const dbSession = await prisma.session.findUnique({
            where: { sessionToken },
            include: { user: true }
          })
          if (dbSession && dbSession.expires > new Date()) {
            session = {
              user: {
                id: dbSession.user.id,
                email: dbSession.user.email,
                name: dbSession.user.name,
                image: dbSession.user.image,
              },
            }
          }
        }
      }
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = DeleteAPIKeySchema.parse(data)

    // Get current settings
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpSettings: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const mcpSettings = parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, 'user/ai-api-keys')
    const apiKeys = mcpSettings.apiKeys || {}

    // Remove the API key
    delete apiKeys[validatedData.serviceId]

    // Update user settings
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        mcpSettings: JSON.stringify({
          ...mcpSettings,
          apiKeys
        })
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, "Error deleting AI API key:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}