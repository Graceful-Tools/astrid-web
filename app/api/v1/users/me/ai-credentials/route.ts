/**
 * GET /api/v1/users/me/ai-credentials — list configured AI service keys
 * PUT /api/v1/users/me/ai-credentials — save/update a key (or OpenClaw URL)
 * DELETE /api/v1/users/me/ai-credentials — remove a service's key
 *
 * Mirrors GET/PUT/DELETE /api/user/ai-api-keys.
 *
 * Keys are AES-256-CBC encrypted at rest with ENCRYPTION_KEY (hex).
 * The GET response only includes a preview slice + metadata, never
 * the decrypted key itself.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { MCPSettingsSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.ai-credentials')

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is required')
  return key
}

const SaveSchema = z.object({
  serviceId: z.enum(['claude', 'openai', 'gemini', 'openclaw']),
  apiKey: z.string().min(1).optional(),
  gatewayUrl: z.string().min(1).optional(),
  authToken: z.string().optional(),
}).refine(
  data => (data.serviceId === 'openclaw' ? !!data.gatewayUrl : !!data.apiKey),
  { message: 'OpenClaw requires gatewayUrl, other services require apiKey' }
)

const DeleteSchema = z.object({
  serviceId: z.enum(['claude', 'openai', 'gemini', 'openclaw']),
})

function encrypt(text: string): { encrypted: string; iv: string } {
  const key = Buffer.from(getEncryptionKey(), 'hex')
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return { encrypted, iv: iv.toString('hex') }
}

function decrypt(d: { encrypted: string; iv: string }): string {
  const key = Buffer.from(getEncryptionKey(), 'hex')
  const iv = Buffer.from(d.iv, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  let decrypted = decipher.update(d.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

const getKeyPreview = (k: string) =>
  k.length <= 8 ? '***' : `${k.substring(0, 4)}***${k.substring(k.length - 4)}`

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.ai-credentials' },
  async (_req, auth) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { mcpSettings: true },
      })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      const mcpSettings = parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, 'v1.ai-credentials')
      const apiKeys = mcpSettings.apiKeys || {}
      const keyData: Record<string, unknown> = {}

      for (const [serviceId, info] of Object.entries(apiKeys)) {
        if (typeof info !== 'object' || !info || !('encrypted' in info)) continue
        try {
          const decryptedValue = decrypt(info as { encrypted: string; iv: string })
          const isGateway = (info as { isGateway?: boolean }).isGateway === true
          keyData[serviceId] = {
            hasKey: true,
            keyPreview: isGateway
              ? (decryptedValue.length > 20 ? `${decryptedValue.substring(0, 20)}...` : decryptedValue)
              : getKeyPreview(decryptedValue),
            isValid: (info as { isValid?: boolean }).isValid,
            lastTested: (info as { lastTested?: string }).lastTested,
            error: (info as { error?: string }).error,
          }
        } catch {
          keyData[serviceId] = {
            hasKey: true,
            keyPreview: '***',
            isValid: false,
            error: 'Failed to decrypt key',
          }
        }
      }

      return NextResponse.json({
        keys: keyData,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching AI credentials')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const PUT = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.ai-credentials' },
  async (req, auth) => {
    try {
      const data = SaveSchema.parse(await req.json())
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { mcpSettings: true },
      })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      const mcpSettings = parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, 'v1.ai-credentials')
      const apiKeys = mcpSettings.apiKeys || {}

      if (data.serviceId === 'openclaw') {
        const encryptedUrl = encrypt(data.gatewayUrl!)
        const encryptedToken = data.authToken ? encrypt(data.authToken) : null
        apiKeys[data.serviceId] = {
          ...encryptedUrl,
          isGateway: true,
          authToken: encryptedToken,
          isValid: null,
          lastTested: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      } else {
        const encryptedKey = encrypt(data.apiKey!)
        apiKeys[data.serviceId] = {
          ...encryptedKey,
          isValid: null,
          lastTested: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      }

      await prisma.user.update({
        where: { id: auth.userId },
        data: { mcpSettings: JSON.stringify({ ...mcpSettings, apiKeys }) },
      })

      return NextResponse.json({
        success: true,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error saving AI credential')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const DELETE = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.ai-credentials' },
  async (req, auth) => {
    try {
      const data = DeleteSchema.parse(await req.json())
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { mcpSettings: true },
      })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      const mcpSettings = parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, 'v1.ai-credentials')
      const apiKeys = mcpSettings.apiKeys || {}
      delete apiKeys[data.serviceId]

      await prisma.user.update({
        where: { id: auth.userId },
        data: { mcpSettings: JSON.stringify({ ...mcpSettings, apiKeys }) },
      })

      return NextResponse.json({
        success: true,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error deleting AI credential')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
