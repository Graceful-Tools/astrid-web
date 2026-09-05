import { NextRequest, NextResponse } from 'next/server'

import { reconcileAllAgentLifecycleBoards } from '@/lib/agent-lifecycle'
import { requireCronSecret } from '@/lib/cron-auth'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron.agent-lifecycle')

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  try {
    const result = await reconcileAllAgentLifecycleBoards()
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    log.error({ err: error }, 'Agent lifecycle reconciliation failed')
    return NextResponse.json(
      { success: false, error: 'Agent lifecycle reconciliation failed' },
      { status: 500 },
    )
  }
}
