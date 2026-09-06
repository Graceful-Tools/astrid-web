import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import {
  copilotIntegrationGate,
  hasCopilotCredential,
  revokeCopilotCredential,
} from '@/lib/copilot/oauth'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.integrations.copilot.status' },
  async (_req, auth) => {
    // A brand without the copilot agent has no Copilot integration to
    // authorize against (task 229c175c).
    const gateBlocked = copilotIntegrationGate()
    if (gateBlocked) return gateBlocked

    return NextResponse.json({ connected: await hasCopilotCredential(auth.userId) })
  },
)

export const DELETE = withAuth(
  { scopes: ['user:write'], tag: 'v1.integrations.copilot.status' },
  async (_req, auth) => {
    // A brand without the copilot agent has no Copilot integration to
    // authorize against (task 229c175c).
    const gateBlocked = copilotIntegrationGate()
    if (gateBlocked) return gateBlocked

    await revokeCopilotCredential(auth.userId)
    return NextResponse.json({ connected: false })
  },
)
