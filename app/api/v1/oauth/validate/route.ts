import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'

/** Token-only validation for a hosted MCP proxy targeting this deployment. */
export const GET = withAuth(
  { tokenOnly: true, tag: 'v1.oauth.validate' },
  () => new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } }),
)
