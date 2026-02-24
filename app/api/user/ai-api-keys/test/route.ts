import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { RATE_LIMITS, withRateLimit } from "@/lib/rate-limiter"
import { z } from "zod"
import crypto from "crypto"

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex')

const TestAPIKeySchema = z.object({
  serviceId: z.enum(['claude', 'openai', 'gemini', 'openclaw'])
})

// Decryption function
function decrypt(encryptedData: { encrypted: string; iv: string }): string {
  const algorithm = 'aes-256-cbc'
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = Buffer.from(encryptedData.iv, 'hex')
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

async function testClaudeKey(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Use the same endpoint and format as the AI orchestrator
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', // Use fastest model for testing
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Test'
          }
        ]
      })
    })

    if (response.ok) {
      return { success: true }
    } else {
      const error = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${error}` }
    }
  } catch (error) {
    return { success: false, error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}` }
  }
}

async function testOpenAIKey(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      return { success: true }
    } else {
      const error = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${error}` }
    }
  } catch (error) {
    return { success: false, error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}` }
  }
}

async function testGeminiKey(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)

    if (response.ok) {
      return { success: true }
    } else {
      const error = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${error}` }
    }
  } catch (error) {
    return { success: false, error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}` }
  }
}

export async function POST(request: NextRequest) {
  // Apply strict rate limiting for API key testing
  const rateLimitCheck = withRateLimit(RATE_LIMITS.API_KEY_TEST)(request)

  if (!rateLimitCheck.allowed) {
    console.log('🚫 API key test rate limited')
    return NextResponse.json(
      rateLimitCheck.error,
      {
        status: 429,
        headers: rateLimitCheck.headers
      }
    )
  }

  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = TestAPIKeySchema.parse(data)

    // Get user's API keys
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpSettings: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const mcpSettings = user.mcpSettings ? JSON.parse(user.mcpSettings) : {}
    const apiKeys = mcpSettings.apiKeys || {}
    const keyData = apiKeys[validatedData.serviceId]

    if (!keyData || !keyData.encrypted) {
      return NextResponse.json(
        { success: false, error: "API key not found" },
        { status: 404 }
      )
    }

    // Decrypt the API key
    let decryptedKey: string
    try {
      decryptedKey = decrypt(keyData)
    } catch (error) {
      return NextResponse.json(
        { success: false, error: "Failed to decrypt API key" },
        { status: 500 }
      )
    }

    // Test the API key based on service
    let testResult: { success: boolean; error?: string }

    switch (validatedData.serviceId) {
      case 'claude':
        testResult = await testClaudeKey(decryptedKey)
        break
      case 'openai':
        testResult = await testOpenAIKey(decryptedKey)
        break
      case 'gemini':
        testResult = await testGeminiKey(decryptedKey)
        break
      case 'openclaw':
        // OpenClaw connects via channel plugin — no gateway URL to test
        testResult = { success: false, error: 'OpenClaw now connects via the channel plugin. No API key or gateway URL needed.' }
        break
      default:
        return NextResponse.json(
          { success: false, error: "Unsupported service" },
          { status: 400 }
        )
    }

    // Update the key validation status
    apiKeys[validatedData.serviceId] = {
      ...keyData,
      isValid: testResult.success,
      lastTested: new Date().toISOString(),
      error: testResult.error || null,
      updatedAt: new Date().toISOString()
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        mcpSettings: JSON.stringify({
          ...mcpSettings,
          apiKeys
        })
      }
    })

    return NextResponse.json({
      success: testResult.success,
      error: testResult.error
    })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
        { status: 400 }
      )
    }

    console.error("Error testing AI API key:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}