/**
 * GET/PUT/DELETE /api/v1/users/me/ai-model-preferences
 *
 * Which model the user has chosen for each AI service. Successor to
 * /api/user/ai-model-preferences (task 641a7615, decision 3A).
 *
 * This is the gap the first audit missed, and the reason is worth recording:
 * the audit matched legacy routes to v1 by NAME, and this one looked covered by
 * `/api/v1/users/me/ai-preferences`. It is not. ai-preferences holds
 * `preferredService` and `defaultAgentId` — which service and agent to use, not
 * which model to run. Neighbouring names, unrelated resources.
 *
 * The hazard here is that `user.mcpSettings` is a single JSON column shared with
 * the encrypted API keys. Every write is a read-modify-write, so it must merge
 * into the settings it just read; rebuilding the blob from the preferences alone
 * would delete the user's keys as a side effect. `MCPSettingsSchema` is
 * `.passthrough()`, so spreading the parsed object carries siblings across
 * untouched — including any this route does not know about.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { MCPSettingsSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { DEFAULT_MODELS, SUGGESTED_MODELS, type AIService } from '@/lib/ai/agent-config'

const TAG = 'v1.users.me.ai-model-preferences'

const SERVICES = ['claude', 'openai', 'gemini', 'copilot', 'openclaw'] as const

const UpdateModelSchema = z.object({
  serviceId: z.enum(SERVICES),
  model: z.string().min(1).max(100),
})

const ResetModelSchema = z.object({
  serviceId: z.enum(SERVICES),
})

const meta = (source: string) => ({ apiVersion: 'v1' as const, authSource: source })

/** Read the shared blob. Returns null when the user row is gone. */
async function readSettings(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mcpSettings: true },
  })
  if (!user) return null
  return parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, TAG)
}

export const GET = withAuth({ scopes: ['user:read'], tag: TAG }, async (_req, auth) => {
  const settings = await readSettings(auth.userId)
  if (!settings) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const stored = settings.modelPreferences ?? {}

  // Every service gets an entry even when unset: the settings panel renders one
  // input per service and needs a value for each, so an absent service would
  // render blank rather than showing what will actually be used.
  const preferences = Object.fromEntries(
    SERVICES.map((service) => [
      service,
      {
        model: stored[service] || DEFAULT_MODELS[service as AIService],
        isDefault: !stored[service],
      },
    ])
  )

  return NextResponse.json({
    preferences,
    defaults: DEFAULT_MODELS,
    suggestions: SUGGESTED_MODELS,
    meta: meta(auth.source),
  })
})

export const PUT = withAuth({ scopes: ['user:write'], tag: TAG }, async (req, auth) => {
  let data: z.infer<typeof UpdateModelSchema>
  try {
    data = UpdateModelSchema.parse(await req.json().catch(() => ({})))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 })
    }
    throw error
  }

  const settings = await readSettings(auth.userId)
  if (!settings) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const modelPreferences = { ...(settings.modelPreferences ?? {}), [data.serviceId]: data.model }

  await prisma.user.update({
    where: { id: auth.userId },
    // Spread first: the same column holds the encrypted API keys.
    data: { mcpSettings: JSON.stringify({ ...settings, modelPreferences }) },
  })

  return NextResponse.json({
    success: true,
    model: data.model,
    isDefault: false,
    meta: meta(auth.source),
  })
})

export const DELETE = withAuth({ scopes: ['user:write'], tag: TAG }, async (req, auth) => {
  let data: z.infer<typeof ResetModelSchema>
  try {
    data = ResetModelSchema.parse(await req.json().catch(() => ({})))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 })
    }
    throw error
  }

  const settings = await readSettings(auth.userId)
  if (!settings) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Reset means "forget my choice", not "store today's default" — writing the
  // default in would freeze the user on it when the default later moves on.
  const modelPreferences = { ...(settings.modelPreferences ?? {}) }
  delete modelPreferences[data.serviceId]

  await prisma.user.update({
    where: { id: auth.userId },
    data: { mcpSettings: JSON.stringify({ ...settings, modelPreferences }) },
  })

  return NextResponse.json({
    success: true,
    model: DEFAULT_MODELS[data.serviceId as AIService],
    isDefault: true,
    meta: meta(auth.source),
  })
})
