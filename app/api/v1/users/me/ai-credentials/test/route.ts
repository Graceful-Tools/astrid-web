/**
 * POST /api/v1/users/me/ai-credentials/test
 *
 * Tests the user's stored API key for a service by calling its provider
 * with a minimal request. Updates the key's `isValid` and `lastTested`
 * status. Mirrors POST /api/v1/users/me/ai-credentials/test.
 *
 * Body: { serviceId: 'claude' | 'openai' | 'gemini' | 'openclaw' }
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.ai-credentials.test')

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex')

const TestSchema = z.object({
  serviceId: z.enum(['claude', 'openai', 'gemini', 'copilot', 'openclaw']),
})

function decrypt(d: { encrypted: string; iv: string }): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = Buffer.from(d.iv, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  let decrypted = decipher.update(d.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

async function testClaude(apiKey: string) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Test' }],
      }),
    })
    if (r.ok) return { success: true }
    return { success: false, error: `HTTP ${r.status}: ${await r.text()}` }
  } catch (error) {
    return { success: false, error: `Network error: ${error instanceof Error ? error.message : 'Unknown'}` }
  }
}

async function testOpenAI(apiKey: string) {
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    })
    if (r.ok) return { success: true }
    return { success: false, error: `HTTP ${r.status}: ${await r.text()}` }
  } catch (error) {
    return { success: false, error: `Network error: ${error instanceof Error ? error.message : 'Unknown'}` }
  }
}

async function testGemini(apiKey: string) {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
    if (r.ok) return { success: true }
    return { success: false, error: `HTTP ${r.status}: ${await r.text()}` }
  } catch (error) {
    return { success: false, error: `Network error: ${error instanceof Error ? error.message : 'Unknown'}` }
  }
}

export const POST = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.ai-credentials.test' },
  async (req, auth) => {
    try {
      const data = TestSchema.parse(await req.json())

      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { mcpSettings: true },
      })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      const mcpSettings = user.mcpSettings ? JSON.parse(user.mcpSettings) : {}
      const apiKeys = mcpSettings.apiKeys || {}
      const keyData = apiKeys[data.serviceId]
      if (!keyData?.encrypted) {
        return NextResponse.json(
          { success: false, error: 'API key not found' },
          { status: 404 }
        )
      }

      let decryptedKey: string
      try {
        decryptedKey = decrypt(keyData)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Failed to decrypt API key' },
          { status: 500 }
        )
      }

      let testResult: { success: boolean; error?: string }
      switch (data.serviceId) {
        case 'claude': testResult = await testClaude(decryptedKey); break
        case 'openai': testResult = await testOpenAI(decryptedKey); break
        case 'gemini': testResult = await testGemini(decryptedKey); break
        case 'openclaw':
          testResult = {
            success: false,
            error: 'OpenClaw now connects via the channel plugin. No API key or gateway URL needed.',
          }
          break
        default:
          return NextResponse.json({ success: false, error: 'Unsupported service' }, { status: 400 })
      }

      apiKeys[data.serviceId] = {
        ...keyData,
        isValid: testResult.success,
        lastTested: new Date().toISOString(),
        error: testResult.error || null,
        updatedAt: new Date().toISOString(),
      }
      await prisma.user.update({
        where: { id: auth.userId },
        data: { mcpSettings: JSON.stringify({ ...mcpSettings, apiKeys }) },
      })

      return NextResponse.json({
        success: testResult.success,
        error: testResult.error,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error testing AI credential')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
