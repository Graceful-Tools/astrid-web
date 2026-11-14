import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { getWebhookDeliverySettings, setWebhookDeliverySettings } from '@/services/webhook-delivery.service'
import { z } from 'zod'

const log = createLogger('v1.users.me.webhook-delivery-policy')
export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.webhook-delivery-policy' },
  async (_req, auth) => {
    try {
      const settings = await getWebhookDeliverySettings(auth.userId)
      return NextResponse.json({
        ...settings,
        meta: { apiVersion: 'v1', authSource: auth.source },
      })
    } catch (err) {
      log.error({ err }, 'Could not read webhook delivery policy')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  },
)

/** Without agent, replace the account default; with agent, replace one binding. */
export const PUT = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.webhook-delivery-policy' },
  async (req, auth) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const input = z.object({
      policy: z.enum(['fallback', 'strict']),
      agent: z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
    }).strict().safeParse(body)
    if (!input.success) {
      return NextResponse.json({ error: 'policy must be fallback or strict; agent must be a mailbox' }, { status: 400 })
    }
    const { policy, agent } = input.data
    try {
      const settings = await setWebhookDeliverySettings(auth.userId, policy, agent)
      if (!settings) {
        return NextResponse.json({ error: 'Settings changed concurrently; reload and retry' }, { status: 409 })
      }
      return NextResponse.json({
        ...settings,
        meta: { apiVersion: 'v1', authSource: auth.source },
      })
    } catch (err) {
      log.error({ err }, 'Could not save webhook delivery policy')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  },
)
