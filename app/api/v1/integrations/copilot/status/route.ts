import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { hasCopilotCredential, revokeCopilotCredential } from '@/lib/copilot/oauth'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.integrations.copilot.status' },
  async (_req, auth) => NextResponse.json({ connected: await hasCopilotCredential(auth.userId) }),
)

export const DELETE = withAuth(
  { scopes: ['user:write'], tag: 'v1.integrations.copilot.status' },
  async (_req, auth) => {
    await revokeCopilotCredential(auth.userId)
    return NextResponse.json({ connected: false })
  },
)
