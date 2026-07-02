import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { googleRequest, googleTokenFor } from '@/lib/sync/google'

/** GET — the caller's Google Tasks tasklists (remote containers). */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.google' },
  async (_req, auth) => {
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })
    const { status, json } = await googleRequest(token, 'GET', '/users/@me/lists?maxResults=100')
    if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: 502 })
    const tasklists = ((json.items as any[]) || []).map(l => ({ id: l.id, name: l.title }))
    return NextResponse.json({ tasklists })
  }
)
